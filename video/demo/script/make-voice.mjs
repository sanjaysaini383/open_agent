// Synthesises each narration line locally with Kokoro (npx hyperframes tts), joins the
// lines into one narration with short gaps, transcribes it once for word timings, and
// writes script/voice-meta.json with each line's start, duration and words.
//   node script/make-voice.mjs
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const GAP = 0.7;
const script = JSON.parse(await readFile("script/voiceover.json", "utf8"));
await mkdir("assets/voice", { recursive: true });
const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32" });
  if (result.status !== 0) { console.error(result.stdout, result.stderr); throw new Error(`${cmd} ${args[0]} failed`); }
  return result.stdout;
};
const probe = (file) => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim());

const lines = [];
let cursor = 0;
for (const line of script.lines) {
  const wav = `assets/voice/${line.id}.wav`;
  if (!existsSync(wav)) run("npx", ["hyperframes", "tts", JSON.stringify(line.text), "-o", wav, "--voice", script.kokoroVoice || "am_michael", "--speed", String(script.speed || 1)]);
  const duration = probe(wav);
  lines.push({ id: line.id, beat: line.beat, text: line.text, wav, start: Math.round(cursor * 100) / 100, duration: Math.round(duration * 100) / 100, words: [] });
  console.log(`${line.id} ${duration.toFixed(2)}s`);
  cursor += duration + GAP;
}
// One narration file: the lines in order with a gap between them.
const inputs = lines.flatMap((line) => ["-i", line.wav]);
const filter = lines.map((_, index) => `[${index}:a]apad=pad_dur=${GAP}[a${index}]`).join(";") + ";" + lines.map((_, index) => `[a${index}]`).join("") + `concat=n=${lines.length}:v=0:a=1[out]`;
run("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", `"${filter}"`, "-map", "[out]", "-ar", "44100", "-ac", "1", "assets/voice/narration.wav"]);
const total = probe("assets/voice/narration.wav");

// Word timings for the captions, from one transcription of the joined narration.
const out = run("npx", ["hyperframes", "transcribe", "assets/voice/narration.wav", "--json"]);
const summary = out.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("{")).map((line) => { try { return JSON.parse(line); } catch { return null; } }).find((item) => item && item.transcriptPath);
const transcript = JSON.parse(await readFile(summary ? summary.transcriptPath : "assets/voice/transcript.json", "utf8"));
const words = (Array.isArray(transcript) ? transcript : transcript.words || []).map((word) => ({ text: word.text, start: word.start, end: word.end }));
for (const word of words) {
  const line = lines.find((item) => word.start >= item.start - 0.15 && word.start < item.start + item.duration + 0.3) || lines[lines.length - 1];
  line.words.push(word);
}
await writeFile("script/voice-meta.json", JSON.stringify({ voice: `Kokoro ${script.kokoroVoice || "am_michael"} (local)`, narration: "assets/voice/narration.wav", total: Math.round(total * 100) / 100, gap: GAP, lines }, null, 2));
console.log(`narration ${total.toFixed(1)}s, ${words.length} words`);
for (const line of lines) console.log(`  ${line.id} @${line.start}s ${line.duration}s ${line.words.length} words`);
