# Lyric Visualizer

A music visualizer where audio drives when things move and lyric meaning
drives what moves. Personal project.

## Run it

```sh
npm install
npm run dev
```

## Song files

Steps 1-3 hardcode one song. Put your own files here:

- `public/song/song.mp3`: the audio
- `public/song/song.lrc`: line-timed lyrics for that exact recording
- `public/song/song.semantics.json`: hand-written semantics (committed;
  it contains no lyric text — the audio and .lrc stay gitignored)

To use different file names, change the constants in `src/App.tsx`.

## Keys

- `L`: show or hide the lyric line
- `D`: debug overlay — the five analysis values as bars, plus the current
  section, chosen motif, and line emphasis
- `S`: toggle semantics on/off (off reproduces the step 2 look, for A/B)

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
- `imagery` tags pick the particle motif (embers, rain, stars, or the
  default drift); the first tag with a mapping wins.
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
  motif, accent strength), eased over ~1.5 s at section changes. Audio
  decides when things move; semantics decide what and how much. This is
  the go/no-go test for the whole idea.
- Next (provisional): step 4, LLM extraction of the same schema.

Analysis (`src/analysis.ts`), mapping (`src/mapping.ts`) and rendering
(`src/scene.ts`) are separate: the renderer sees only
`(AudioFrame, SceneParams, dt)`. The semantic schema and its validation
live in `src/semantics.ts`. All tuning constants live in `src/tuning.ts`.
