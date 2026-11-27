"""Builds assets/music/bed.wav from the licensed loop in assets/music/overlook.mp3.

The loop is repeated with a crossfade until it covers the film (voice-meta total + the
end-card tail), faded in over 2 s and out over the last 3 s, and normalised to -18 LUFS so
`data-volume` in index.html is the only level that matters. Credits: assets/music/CREDITS.md.

    python -I script/make-music.py
"""
import json, math, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
meta = json.loads((ROOT / "script" / "voice-meta.json").read_text(encoding="utf8"))
TAIL = 3.0  # end card after the last word; keep in step with build.mjs
length = math.ceil(meta["total"] + TAIL + 0.5)
src = ROOT / "assets" / "music" / "overlook.mp3"
out = ROOT / "assets" / "music" / "bed.wav"
XFADE = 4
loop = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(src)], check=True, capture_output=True, text=True).stdout)
copies = max(2, math.ceil((length + XFADE) / (loop - XFADE)) + 1)
inputs = []
for _ in range(copies):
    inputs += ["-i", str(src)]
chain, prev = [], "[0:a]"
for i in range(1, copies):
    label = f"[x{i}]"
    chain.append(f"{prev}[{i}:a]acrossfade=d={XFADE}:c1=tri:c2=tri{label}")
    prev = label
chain.append(f"{prev}atrim=0:{length},afade=t=in:st=0:d=2,afade=t=out:st={length - TAIL}:d={TAIL},loudnorm=I=-18:TP=-2:LRA=6[out]")
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(chain), "-map", "[out]", "-ar", "48000", "-ac", "2", str(out)], check=True)
print(f"bed.wav: {length}s from {copies} copies of {src.name} ({loop:.1f}s loop)")
