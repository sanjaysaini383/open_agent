# REVIEW — ReliefMesh demo film (second cut)

Render: `renders/reliefmesh-demo.mp4`, 1920×1080, 30 fps, 116 s. Built to
[`video/PRODUCTION.md`](../PRODUCTION.md): one incident followed from need to receipt,
timed to the twelve-line narration in `script/voiceover.json`.

## What changed from the first cut, and why

The first cut was judged basic: the Kokoro narration was flat with artificial pauses, every
scene entered with the same fade-and-scale, shots sat still, and there was no music. The
pipeline was changed rather than the animations patched:

- **Voice.** One continuous read by a female Indian-English neural voice
  (`en-IN-NeerjaNeural`, edge-tts) at 147 wpm. The engine's 0.83 s sentence breaks were cut
  down to 0.42 s from the middle of each silence; 24 pauses shortened, word times shifted to
  match. Measured: no silence of 0.5 s or longer anywhere in the narration
  (`silencedetect`, −35 dB), the longest gap between any two words is 0.42 s.
- **Music.** A CC0 ambient loop ("Overlook", credited in `assets/music/CREDITS.md`) looped to
  the film's length, −18 LUFS, mounted at 0.3 with an automation lane that keeps it at 62 %
  under the voice and lets it rise after the last word.
- **Transitions.** Scenes overlap by 0.45 s. Push, iris and zoom-through alternate; the
  outgoing scene is visible under the incoming one (scene roots are transparent, the ground
  travels with the stage). Checked in frames: three instants inside each of four cuts.
- **Camera.** Every product chapter has a camera path cued to the narration and a 3.5 %
  creep on each hold. The hostile-supplier chapter travels across the card from its
  "Unverified" badge to its price lines to the "Excluded" label as the words are spoken.
- **Opening.** The first frame is inside the real map with the incident marker and a pulse,
  pulling out to the dashboard while the number counts to 12,000 on the word "twelve".
- **Cues.** Every title line, tag and number lands on a spoken word (`wAt` in `build.mjs`);
  three short tags at most per chapter. The weak window-prompt shot from the first cut is
  gone: the approval cuts, through an iris, straight to the supplier's own window, where the
  "Reserved" receipt replaces the question as the narration says "window", then pushes to the
  carrier's window on "Transport".
- **Ending.** The tagline appears word by word on its own word times, then the address and
  the honesty line, then the mesh draws itself behind the mark while the music swells.

## Sound, measured

- Narration file: −21.1 LUFS, LRA 1.9 LU, 113.0 s, 274 words.
- The mix after `script/finish.py` (loudnorm −16 LUFS / −1.5 dBTP): see the numbers printed
  by `npm run video:render`; they are recorded at the end of this file after each render.
- Nobody listened to the file in this session: there is no audio output in the agent's
  environment. The voice was chosen from a known female voice id, the pauses and the rate
  were measured, and the pronunciation of "ReliefMesh", "AidSupply" and "RouteBridge" is the
  engine's default. A person should listen once before publishing (PRODUCTION.md §5.3).

## What was looked at

- `npx hyperframes check --json`: ok, no errors, no warnings. Two `info` findings remain:
  the drifting dot grid and the glow extend past the canvas on purpose.
- Snapshots at 23 instants across the film and 12 instants inside transitions, read as
  contact sheets: the counter is hidden until it starts, titles do not wrap, origin pills
  clear the captions, chapter labels clear the tag row, "12 / 12" and "267" count in the
  large type, the mesh lines sit behind the text at 20 % opacity.

## Weakest shot

The tracking chapter runs the recording at about 2.8× to fit three status clicks into
4.4 s; the table scrolls fast. With more time: record the three clicks closer together, or
give the chapter a line of its own.

## Warnings kept on purpose

None. The two info-level findings above are intentional overflow.

## Latest render measurements (2026-11-27)

- Render: 3480 frames, motion blur on, 0 failed frames; H.264 1920×1080 30 fps, AAC 48 kHz, 116.0 s.
- Mix before `finish.py`: −17.6 LUFS, peak −1.0 dBFS, LRA 2.2 LU. After: −15.8 LUFS,
  peak −1.0 dBFS, LRA 2.2 LU.
- `silencedetect` at −40 dB over the finished file: no silence of 0.4 s or longer anywhere.
- `npx hyperframes audio`: sound from 0.13 s; the steepest rise at 30.3 s (the consent
  click), the peak at 58.4 s (the hostile supplier's "Excluded" tag).
