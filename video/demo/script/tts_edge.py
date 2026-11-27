"""Narration with Microsoft's neural voices (edge-tts), as one continuous read.

The whole script is synthesised in a single request, paragraph by paragraph, so the
pauses are the voice's own. The service returns a word boundary for every word, so
caption timings are exact rather than transcribed. The engine's fixed sentence break
(about 0.83 s) is then shortened to a natural breath (MAX_GAP) by cutting the silence
out of the audio, and every word time is shifted by exactly what was removed.

    python -I script/tts_edge.py            # reads script/voiceover.json
Writes assets/voice/narration.wav (48 kHz mono) and script/voice-meta.json.
"""
import asyncio, json, re, subprocess, sys
from pathlib import Path

import edge_tts

sys.stdout.reconfigure(encoding="utf8")
ROOT = Path(__file__).resolve().parent.parent
script = json.loads((ROOT / "script" / "voiceover.json").read_text(encoding="utf8"))
voice = script.get("voice", "en-IN-NeerjaNeural")
rate = script.get("rate", "+0%")
pitch = script.get("pitch", "+0Hz")
MAX_GAP = float(script.get("maxGapSeconds", 0.42))
lines = script["lines"]
text = "\n\n".join(line["text"] for line in lines)
out_dir = ROOT / "assets" / "voice"
out_dir.mkdir(parents=True, exist_ok=True)
raw_mp3 = out_dir / "narration-raw.mp3"
raw_wav = out_dir / "narration-raw.wav"
wav = out_dir / "narration.wav"

def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout

async def synth():
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, boundary="WordBoundary")
    words = []
    with open(raw_mp3, "wb") as handle:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                handle.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                words.append({"text": chunk["text"], "start": chunk["offset"] / 1e7, "end": (chunk["offset"] + chunk["duration"]) / 1e7})
    return words

words = asyncio.run(synth())
run(["ffmpeg", "-v", "error", "-y", "-i", str(raw_mp3), "-ar", "48000", "-ac", "1", str(raw_wav)])
raw_duration = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(raw_wav)]).strip())

# Shorten every pause longer than MAX_GAP to MAX_GAP: cut the middle of the silence so
# the voice's own tail and onset stay intact, then shift later words by what was cut.
cuts = []  # (cut_start, cut_end) in raw time
for a, b in zip(words, words[1:]):
    gap = b["start"] - a["end"]
    if gap > MAX_GAP:
        extra = gap - MAX_GAP
        mid = a["end"] + gap / 2
        cuts.append((mid - extra / 2, mid + extra / 2))
segments = []
cursor = 0.0
for start, end in cuts:
    segments.append((cursor, start))
    cursor = end
segments.append((cursor, raw_duration))
if cuts:
    filter_parts = [f"[0:a]atrim=start={s:.4f}:end={e:.4f},asetpts=PTS-STARTPTS[s{i}]" for i, (s, e) in enumerate(segments)]
    filter_graph = ";".join(filter_parts) + ";" + "".join(f"[s{i}]" for i in range(len(segments))) + f"concat=n={len(segments)}:v=0:a=1[out]"
    run(["ffmpeg", "-v", "error", "-y", "-i", str(raw_wav), "-filter_complex", filter_graph, "-map", "[out]", "-ar", "48000", "-ac", "1", str(wav)])
else:
    run(["ffmpeg", "-v", "error", "-y", "-i", str(raw_wav), str(wav)])
duration = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)]).strip())

def shifted(t):
    removed = sum(min(max(0.0, t - s), e - s) for s, e in cuts)
    return round(t - removed, 3)
for w in words:
    w["start"], w["end"] = shifted(w["start"]), shifted(w["end"])

# Attribute the words to the script's lines in order.
norm = lambda s: re.sub(r"[^a-z0-9']+", "", s.lower())
pos = 0
for line in lines:
    budget = len([t for t in (norm(t) for t in line["text"].split()) if t])
    line_words = []
    while pos < len(words) and budget > 0:
        w = words[pos]; line_words.append(w); pos += 1
        budget -= max(1, len(norm(w["text"]).split()))
    line["words"] = line_words
    line["start"] = round(line_words[0]["start"], 2)
    line["end"] = round(line_words[-1]["end"], 2)
    line["duration"] = round(line["end"] - line["start"], 2)

word_count = sum(len(l["text"].split()) for l in lines)
spoken = lines[-1]["end"] - lines[0]["start"]
meta = {
    "voice": f"{voice} via edge-tts, rate {rate}, pitch {pitch}; pauses capped at {MAX_GAP}s",
    "narration": "assets/voice/narration.wav",
    "total": round(duration, 2),
    "rawTotal": round(raw_duration, 2),
    "pausesShortened": len(cuts),
    "wordsPerMinute": round(word_count / (spoken / 60), 1),
    "lines": [{"id": l["id"], "beat": l["beat"], "text": l["text"], "start": l["start"], "end": l["end"], "duration": l["duration"], "words": l["words"]} for l in lines],
}
(ROOT / "script" / "voice-meta.json").write_text(json.dumps(meta, indent=2), encoding="utf8")
print(f"{voice}: {raw_duration:.1f}s raw -> {duration:.1f}s after shortening {len(cuts)} pauses to <= {MAX_GAP}s; {len(words)} words, {meta['wordsPerMinute']} wpm")
for l in meta["lines"]:
    print(f"  {l['id']} {l['start']:>7}s - {l['end']:>7}s  ({l['duration']}s, {len(l['words'])} words)")
