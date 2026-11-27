# Video production standard

Every film made in this repository follows this standard. The pipeline enforces most of it:
the scripts under `video/demo/script/` generate the whole composition from the narration's
word timings, so a new film inherits the standard by reusing them. What they cannot enforce
is listed under "Before a render" and is checked by hand.

## 1. Voice

- **Engine:** Microsoft neural voices through `edge-tts` (`script/tts_edge.py`). The default
  voice is `en-IN-NeerjaNeural`, a female Indian-English voice; `en-IN-NeerjaExpressiveNeural`
  is the expressive variant. Kokoro (`npx hyperframes tts`) is no longer used for narration:
  its read was flat and the per-line joins put an artificial 0.7 s of silence between
  sentences.
- **One request for the whole script.** The lines of `script/voiceover.json` are sent as one
  text, paragraph by paragraph, so the pacing and the breaths are the voice's own. Never
  synthesise line by line and concatenate.
- **Pace:** 140–160 words a minute. Set `rate` in `voiceover.json` (`+7%` reaches 147 wpm
  with this script). The script prints the measured rate.
- **Pauses:** the engine leaves about 0.83 s at every sentence end. The script cuts every gap
  longer than `maxGapSeconds` (default 0.42 s) out of the middle of the silence, keeps the
  voice's own tail and onset, and shifts every later word time by exactly what was removed.
  The output never contains a gap longer than that value; the script's summary shows how
  many were shortened.
- **Word timings** come from the service's word boundaries, not from a transcription, so the
  captions and every cue in the film are exact.
- Verify: `python -I script/tts_edge.py` prints `voice: raw -> trimmed, N pauses shortened,
  wpm`; then
  `ffmpeg -i assets/voice/narration.wav -af silencedetect=noise=-35dB:d=0.5 -f null -`
  must report no silence inside the narration.

## 2. Music and effects

- A film longer than fifteen seconds carries a music bed. `script/make-music.py` loops a
  licensed track (CC0 or CC BY, credited in `assets/music/CREDITS.md`) to the film's length
  with a 4 s crossfade, a 2 s fade in and a 3 s fade out, normalised to −18 LUFS.
- The bed is mounted once in `index.html` at `data-volume="0.3"` with an automation lane
  that holds it at 62 % under the narration and lets it rise to 100 % only after the last
  word. That keeps the music about 12 dB under the voice.
- Effects come from the bundled CC0 library: a whoosh on a push or iris, a short glitch on a
  zoom-through, a click on every real cursor click in the recording, a soft pop when a tag or
  a number lands, one riser cresting on the cut into the approval. Each sound has a visible
  cause. Overlapping sounds of one kind take a second Studio lane automatically.
- After the render, the file is normalised in place with ffmpeg `loudnorm` to −16 LUFS
  integrated, −1.5 dBTP, picture copied. Measure with `ebur128` before and after.

## 3. Picture

- **The product is shown with its own pixels.** The recording sits in a browser frame on the
  dark ground; it is never colour-graded, blurred or darkened. Emphasis comes from framing:
  a camera push to the control the cursor uses, a slow creep on every hold (3.5 % per hold,
  never a static frame), and a pull-out when the narration widens.
- **Transitions, never hard cuts.** Consecutive scenes overlap by `OVER` (0.45 s). Three
  kinds, alternated so no two in a row are the same: zoom-through (the outgoing scene scales
  up and fades while the incoming one scales in), push (outgoing slides left, incoming
  arrives from the right), iris (the incoming scene opens from a point; used when a window
  opens or a name appears). The scene root is transparent and the ground lives inside the
  moving stage, so the outgoing scene is visible under the incoming one.
- **Every title is cued to a spoken word.** Scenes read their times from
  `script/voice-meta.json` through `wAt(beat, word)`; nothing is timed by eye. Title lines
  rise out of a mask; numbers count up; callout tags land on the word they name.
- **Text budget:** one chapter label and at most three short tags per product chapter, plus
  the captions. Never a paragraph on screen. Type floors: 28 px for labels and tags, 34 px
  for subtitles, 44 px for captions.
- **Open on the real thing.** The first frame is inside the recording (the live map with the
  incident marker and a pulse), not a title card; the number lands by 1.5 s.
- **End on the claim.** The tagline appears word by word as it is spoken, then the
  repository address and the honesty line, then the mesh draws itself behind the mark.

## 4. Sync

- Scene boundaries are the start of the line that narrates them. Shots inside a chapter are
  split on the word that changes the subject (`A1 = wAt("approval", "confirmed")`).
- Footage playback rate is derived from the beats in `video/footage/beats.json` so the real
  click lands inside the shot (`A1_RATE`, `T1_RATE` in `build.mjs`).

## 5. Before a render

1. `node script/build.mjs` then `npx hyperframes check --json`: zero errors, every warning
   read and either fixed or written down in `REVIEW.md`.
2. `npx hyperframes snapshot --at …` at every scene start and mid-point, and three frames
   inside at least four transitions. Read the frames: no text under footage, no two titles
   at once, no tag over a chapter label, no single-digit counter before the count starts.
3. Listen to the narration file once from start to end. Confirm the voice is female, the
   pronunciation of product names, and that no sentence is cut.
4. Render, normalise, measure (`ebur128`), run `npx hyperframes audio --json` on the result.
5. Write `REVIEW.md`: what was measured, what was looked at, what was heard, the weakest
   shot, and any warning kept on purpose. Never describe a render as reviewed if nobody
   listened to it.

## Commands

```shell
npm run video:record   # drive the product in Chrome; writes the footage and beats.json
npm run video:voice    # edge-tts narration with word timings, then the music bed
npm run video:build    # generate index.html and the scenes from the timings
npm run video:render   # render, then normalise to -16 LUFS
```
