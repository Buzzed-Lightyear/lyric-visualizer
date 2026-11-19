# Lyric Visualizer

A music visualizer where audio drives when things move and lyric meaning
drives what moves. Personal project.

## Run it

```sh
npm install
npm run dev
```

## Song files

Steps 1-2 hardcode one song. Put your own files here:

- `public/song/song.mp3`: the audio
- `public/song/song.lrc`: line-timed lyrics for that exact recording

Everything in `public/song/` is gitignored, so audio and lyrics never get
committed. To use different file names, change `AUDIO_SRC` and `LRC_SRC`
in `src/App.tsx`.

## Keys

- `L`: show or hide the lyric line
- `D`: debug overlay with the five analysis values as bars

## Status

- **Step 1, sync one song: done.** The current lyric line follows
  `audio.currentTime` every frame; pause and seek just work.
- **Step 2, make it move: built.** The audio graph
  (`createMediaElementSource` → `AnalyserNode`) reduces each frame to five
  0..1 values — level, bass, mid, high, beat — and a full-window canvas
  scene runs on them: drifting particles (speed and brightness from level,
  path wander from mid, twinkle from high) around a central glow that
  swells with bass and kicks on beat. Paused, it settles into a slow idle.
- Next: step 3, hand-written semantics for one song, mapped to visuals.

Analysis and rendering are separate modules (`src/analysis.ts`,
`src/scene.ts`) that share only the `AudioFrame` shape. All tuning
constants (band edges, beat thresholds, decay rates, scene motion) live in
`src/tuning.ts`.
