# Lyric Visualizer

A music visualizer where audio drives when things move and lyric meaning
drives what moves. Personal project.

## Run it

```sh
npm install
npm run dev
```

## Verify it

```sh
npm run verify   # lint + build + unit tests + visual checks
```

`npm run shots` drives the real scene headlessly (Playwright) through a
dev-only harness (`/harness.html`): it steps the scene with a fixed
1/60 s clock and a scripted audio track built from the committed
semantics file (level follows section energy, steady 120 BPM beat), so
no audio file is needed. It writes `shots/contact-sheet.png` (one
labeled tile per section plus an 8-frame filmstrip across every section
boundary) and `shots/report.json`, and fails on the checks defined in
`src/thresholds.ts`: blank tiles, differently labeled sections that look
alike, the two choruses not matching, semantics-off differing from the
neutral look, motion not rising with loudness (or freezing at silence),
single-frame jumps inside transitions, and draw time over budget. The
scene is deterministic (seeded randomness, no clock or window reads), so
repeats of a section render identically. Look at the contact sheet after
changing visuals; the checks catch regressions, not taste.

## Song files

Steps 1-3 hardcode one song. Put your own files here:

- `public/song/song.mp3`: the audio
- `public/song/song.lrc`: line-timed lyrics for that exact recording
- `public/song/song.semantics.json`: hand-written semantics (committed;
  it contains no lyric text — the audio and .lrc stay gitignored)

To use different file names, change the constants in `src/App.tsx`.

## Keys

- `L`: show or hide the lyrics (physics text or the DOM line)
- `T`: physics text vs the old single DOM lyric line
- `B`: cycle the background — butterchurn / canvas scene / black
- `[` / `]`: previous / next ranked candidate for the current section
  (top 8); the choice is saved for that section label
- `N`: never show this preset again, then move to the next candidate
- `Shift+[` / `Shift+]`: browse the whole catalog (not saved)
- `E` / `H` / `X`: cycle the entrance / hold / exit part
- `F`: cycle the type voice; `Y`: cycle the layout
- `1`-`5`: force one of the original five combinations (slam, drop,
  float, tremble, swing); `0` returns everything to the mood mapping
- `D`: debug overlay — analysis bars, section, committed key, emphasis,
  background mode + preset name, and the current voice, layout,
  entrance, hold and exit (with forced overrides marked)
- `S`: toggle semantics on/off (off reproduces the step 2 look, for A/B)
- `K`: tuning panel (Tweakpane) — live sliders for every numeric knob in
  `src/tuning.ts`, grouped by module. Edits apply on the next frame and
  are not persisted; use "log values to console" and copy keepers into
  `src/tuning.ts`. Particle counts and FFT size apply at startup only.

## Step 3 spike: MilkDrop background + kinetic typography

An exploration rig for auditioning motion and presets, not a finished
look. Three layers: butterchurn (WebGL 2, falls back to the canvas scene
if unavailable) renders MilkDrop-style visuals fed by the same
MediaElementSource; a dark scrim plus a palette tint keeps text
readable; and a Canvas 2D layer on top runs physics-driven typography.

### Animation parts

Every line gets an entrance, a hold and an exit — three independent
parts. Audio drives all ongoing motion (beat = impulse, bass = shake and
scale pulse, level = energy); semantics choose parts and strengths only.
Letter-level bodies are used where a part needs them (pop, assemble,
wave, shatter); words stay the unit for layout. Everything gets squash
and stretch (area preserved, one strength knob: text › squashStretch)
and optional ghost trails (text › ghostTrails, off by default).

- Entrances: slam (from depth), fall, buoy (rise), creep (scale-in),
  hang (tilted), whip (shoots in from a side, stretched), fling (thrown
  on an arc with spin), pop (letters scale up, staggered), assemble
  (letters fly in from scattered points), unfold (hinge on the baseline).
- Holds: jolt (stiff, beats jolt), rest (gravity onto a floor), bob
  (weak springs, bass bob), tremble (noise from mid/high), pendulum
  (hangs and swings), pulse (breathes with bass), wave (a ripple runs
  across the letters, kicked by beats), still.
- Exits: tumble, collapse (floor gives way), liftOff, blow (a sideways
  gust, staggered), sink (collapses to the line center), snap (hard cut
  on the next beat), knock (the incoming line shoves the outgoing words
  away), shatter (letters fly out and fall).
- The original five behaviors are combinations: slam = slam/jolt/tumble,
  drop = fall/rest/collapse, float = buoy/bob/liftOff, tremble =
  creep/tremble/tumble, swing = hang/pendulum/tumble.
- Legibility is kept by an assist: an extra spring toward the slot that
  ramps in before the 0.35 s settle deadline, so even weak holds arrive
  readable without ever being pinned at the tolerance edge.

### Type voices

Named voices (family, weight, case, tracking, italic), all OFL via
Fontsource, loaded before the first frame: block (Archivo Black), air
(Inter Light), condensed (Anton), serif (Playfair Display), whisper
(Cormorant Garamond italic), mono (Space Mono), marker (Permanent
Marker), slab (Alfa Slab One).

### Layouts

centered (wrapped rows), lockup (each row scaled to one block width),
focus (one word at a time, large — only when the estimated pace is at or
under 3 words/s with every word readable for 0.25 s, else it falls back
to centered).

### Mapping

Mood -> hold + voice (+ an accent voice for lines with emphasis >= 0.85).
Energy -> entrance (calm at low energy, violent at high), varied
deterministically per line so consecutive lines differ. Emphasis ->
size, layout (focus at the top, lockup in the middle) and exit (shatter
or knock at the top, sink or blow at the bottom, else the hold's
default).

**Word onsets are an estimate**: the LRC is line-timed, so words are
spread across the first ~70% of each line's duration (capped), weighted
by word length (src/onsets.ts). Real word timing would need alignment
tooling, which is out of scope.

The harness films every entrance, hold, exit, voice and layout, sweeps
all entrance x hold x exit combinations by introspection (no drawing)
against the legibility rules, and checks that no frame ever drew text
before the fonts were ready.

## Background preset catalog

All four installed butterchurn-presets packs load lazily (~395 distinct
presets). `npm run catalog` renders every preset headlessly against a
scripted test track (butterchurn's render() takes injected audio and a
fixed clock, so capture is offline and deterministic: quiet part, loud
part, steady beats) and writes a 4-frame strip per preset plus measured
numbers (dominant colors, brightness, saturation, motion, detail, beat
response, flicker, white-text readability, draw cost) to the gitignored
`catalog-strips/`. It is resumable and flags presets that error, stay
blank, strobe hard, or cost far more than the median.

Tagging: subagents read each preset's strip and measurements (the name
is an ID only) and return a one-sentence description, four 0..1 axes
(arousal, valence, tension, warmth), 1-4 imagery tags from a fixed
vocabulary, and a 1-5 quality score — see `scripts/tagging-rubric.md`.
Six hand-tagged anchors calibrate every batch and two control presets
repeat across all batches; a batch whose controls stray is rerun.
`scripts/mergeCatalog.mjs` validates and merges everything into the
committed `src/presetCatalog.json`.

Picking: each mood maps to the same four axes; every usable preset is
scored per section (axes closeness, energy vs arousal and motion,
palette vs dominant colors, imagery overlap through synonyms,
readability, quality — weights in `tuning.ts` PRESET_SCORE). Banned,
broken, blank and hard-strobing presets never play; same-label sections
share one preset; neighbouring sections never share; same inputs give
the same picks. Your [ ] / N feedback persists to
`src/presetFeedback.json` through a dev-only Vite endpoint (reset
button in the K panel).

## Semantics file format

```json
{
  "sections": [
    {
      "start": 42.08, "end": 59.59,
      "label": "hook", "energy": 0.8, "mood": "menacing",
      "palette": ["#120a0d", "#e03535", "#ffb199", "#ff8a5c"],
      "imagery": ["embers", "gunmetal", "sirens"]
    }
  ],
  "lines": [{ "time": 42.08, "emphasis": 0.9 }]
}
```

- `start`/`end` in seconds; sections must not overlap.
- `energy` 0..1 scales baseline intensity (particle count, speed, glow).
- `mood` is one short word mapped to motion character (smooth vs jittery,
  rising vs sinking); unknown moods fall back to neutral.
- `palette` is 3-5 hex colors: background, glow, particles, accent ring.
- `imagery` tags pick the motif; the first tag with a mapping wins, and
  unknown tags fall through to haze. Motifs: **embers** (rise from the
  bottom, flicker, cool as they climb, heat glow along the bottom),
  **rain** (long angled streaks in depth layers, dim glow high up),
  **stars** (fixed field with slow parallax, twinkle from high, soft
  horizon glow), **haze** (large drifting blobs and blurred bokeh
  lights; smoke, city-night, streetlights, fluorescent land here), and
  **drift** (the step 2 look, used only for neutral).
- `lines` map an LRC start time to emphasis 0..1: how hard beat accents
  land during that line. Unlisted lines default to 0.5.

The file is validated on load; problems are listed in the console and the
scene runs neutral.

## Status

- **Step 1, sync one song: done.** The current lyric line follows
  `audio.currentTime` every frame; pause and seek just work.
- **Step 2, make it move: done.** The audio graph
  (`createMediaElementSource` → `AnalyserNode`) reduces each frame to five
  0..1 values — level, bass, mid, high, beat — that drive a full-window
  canvas scene. Paused, it settles into a slow idle.
- **Step 3, fake the semantics: built.** A hand-written semantics file is
  mapped per-frame to `SceneParams` (colors, intensity, motion character,
  motif, accent strength). Each motif is its own renderer with depth
  layers, additive blending and soft sprites over a palette gradient
  background with a vignette. A section change commits on the next beat
  (or after 0.4 s), then the outgoing and incoming motifs crossfade:
  fast with an accent on an energy rise, as a slow dissolve on a fall.
  Audio decides when things move; semantics decide what and how much.
  This is the go/no-go test for the whole idea.
- Next (provisional): step 4, LLM extraction of the same schema.

Analysis (`src/analysis.ts` for the Web Audio graph, `src/audioMath.ts`
for the spectrum math on plain arrays), mapping (`src/mapping.ts`) and
rendering (`src/scene.ts` orchestrating the motif renderers in
`src/motifs.ts`) are separate: the renderer sees only
`(AudioFrame, SceneParams, dt)`. The semantic schema and its validation
live in `src/semantics.ts`. All tuning constants live in `src/tuning.ts`;
verify thresholds in `src/thresholds.ts`.
