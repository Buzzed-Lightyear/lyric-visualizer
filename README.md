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
- `[` / `]`: cycle butterchurn presets (for auditioning)
- `M`: pin the current preset to the current section's mood (saved in
  localStorage; also logs a line to paste into `src/presetMap.ts`)
- `1`-`5`: force a text behavior (slam, drop, float, tremble, swing);
  `0` returns control to the mood mapping
- `D`: debug overlay — analysis bars, section, committed key, motif,
  emphasis, background mode + preset name, text mode + behavior
- `S`: toggle semantics on/off (off reproduces the step 2 look, for A/B)
- `K`: tuning panel (Tweakpane) — live sliders for every numeric knob in
  `src/tuning.ts`, grouped by module. Edits apply on the next frame and
  are not persisted; use "log values to console" and copy keepers into
  `src/tuning.ts`. Particle counts and FFT size apply at startup only.

## Step 3 spike: MilkDrop background + kinetic typography

An exploration rig for auditioning motion behaviors and presets, not a
finished look. Three layers: butterchurn (WebGL 2, falls back to the
canvas scene if unavailable) renders MilkDrop-style visuals fed by the
same `MediaElementSource`; a dark scrim plus a palette tint keeps text
readable; and a Canvas 2D layer on top runs physics-driven typography.
Each word is a spring-tied body (hand-rolled, fixed-step, no physics
library); behaviors (slam, drop, float, tremble, swing, plus a shatter
exit for lines with emphasis >= 0.85) set the spring constants, forces,
entrances and exits. Audio drives all ongoing motion: beat = impulse,
bass = shake and scale pulse, level = energy. Mood picks the default
behavior, type style (Archivo Black / Inter Light, both OFL) and the
background preset (`src/presetMap.ts`); imagery tags are unused here.

**Word onsets are an estimate**: the LRC is line-timed, so words are
spread across the first ~70% of each line's duration (capped), weighted
by word length (`src/onsets.ts`). Real word timing would need alignment
tooling, which is out of scope.

Hard legibility rules, measured by `npm run shots`: within 0.35 s of its
onset a word is upright (±8°), near its slot and on screen, and stays
that way until its exit starts; rest boxes never overlap; at most the
current and outgoing lines are on screen. The harness also films each
behavior's entrance/settle/exit on made-up lines and smoke-tests
butterchurn with an oscillator (skipped with a warning without WebGL 2).

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
