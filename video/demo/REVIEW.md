# REVIEW — ReliefMesh demo film

Render: `renders/reliefmesh-demo.mp4`, 1920×1080, 30 fps, 124.25 s. Built from storyline A
of `STORYLINES.md` to `SPEC.md`, timed to a twelve-line narration (`script/voiceover.json`).

## Creative calls

- The reference the person gave (a narrated 140 s hackathon demo: hook → name card →
  feature chapters in a browser frame → stack card → claim, per-word captions, effects on
  cuts and clicks) sets the form. This film follows that shape at two minutes.
- Storyline A, one incident from need to receipt, was built. Not built: B (five browser
  windows on one stage, the film about the protocol) and C (opening inside the hostile
  supplier's note and zooming out).
- Every product shot is the real recording (`tests/e2e/support/record-demo.mjs` drives the
  real workflow against the five served sites with a visible cursor; `video/footage/beats.json`
  holds the time of every click). Nothing on screen is a mockup. The stack card sits over a
  dimmed still of the Command Center after the run, the one "title over a screenshot" the
  reference itself uses.
- Chapter footage is sped up where the UI only scrolls or waits (2.5× on tracking, 1.8× on
  the approval) and slowed where a table is read (0.44× on trust, 0.43× on allocation).
- Captions are per-word karaoke on a light pill, as in the reference, four words a group.

## Sound

- Narration: local Kokoro (`am_michael`) via `npx hyperframes tts`, joined with 0.7 s gaps.
  HeyGen Voice Turbo was tried first and refused ("needs a HyperFrames plan"); re-voicing
  with a HeyGen voice is a one-command change (`script/make-voice.mjs`) once a plan exists.
- Music: none. The catalog needs the `heygen` CLI and generated music needs a Pro plan;
  Openverse returned no usable bed. The film carries narration and effects only. To add a
  bed, drop a track at `assets/music/bed.mp3` and mount it in `index.html` at `data-volume="0.14"`.
- Effects (bundled library, CC0): a whoosh or a glitch on each chapter cut, a click on each
  real cursor click in the footage, a pop when a badge or a fact lands, one riser cresting
  on the cut into the approval. Each is on its own Studio lane and ends when its sound ends.
- Measured, not heard. The render came out at −20.0 LUFS integrated, true peak −1.0 dBTP
  (ffmpeg ebur128), so the mix was normalised in place with ffmpeg `loudnorm` (picture
  copied, audio re-encoded): −16.3 LUFS, −1.2 dBTP. `npx hyperframes audio` on the file
  finds sound from 0.08 s to 121 s with its peak moment at 74.8 s (the riser into the
  approval). Nobody listened to it.

## What was measured and what was looked at

- `npx hyperframes check --json`: ok, no errors. Two `contrast_aa_failure` warnings remain
  on caption words: the karaoke colour tween passes through intermediate greys below 3:1
  for a few frames; inactive words sit at 3.6:1 and the active word at 14:1. Kept on purpose.
- Snapshots at twenty instants, the review sheets (scene starts and mids, fourteen cut
  strips, the phone sheet): titles land dead still, no title overlaps, captions never stack,
  the chapter label paints above the camera, seams dip for one or two frames with a whoosh.
- The frames were looked at as stills; motion between them was judged from the strips.

## Weakest shot

The window-prompt chapter (s-prompt, 2 s): the dialog is small in the frame even at 1.55×.
With more time: capture the prompt at a tighter scale, or cut straight from the approval to
AidSupply's window and let the narration carry the prompt.

## Warnings kept on purpose

- `contrast_aa_failure` on caption words (above).
- No music bed (above).

## Next turn

Re-run `node script/build.mjs` after changing timings in `script/voice-meta.json` or
footage offsets in `script/build.mjs`; then `npx hyperframes check --json` and render.
