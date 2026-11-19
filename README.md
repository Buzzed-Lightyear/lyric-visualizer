# Lyric Visualizer

A music visualizer where audio drives when things move and lyric meaning
drives what moves. Personal project.

## Run it

```sh
npm install
npm run dev
```

## Song files

Step 1 hardcodes one song. Put your own files here:

- `public/song/song.mp3`: the audio
- `public/song/song.lrc`: line-timed lyrics for that exact recording

Everything in `public/song/` is gitignored, so audio and lyrics never get
committed. To use a different file name or format, change `AUDIO_SRC` in
`src/App.tsx`.

## Step 1: sync one song

Done when the current lyric line shows at the right moment.

- [ ] 1. Scaffold and play: the song plays in the browser
- [ ] 2. Parse LRC into sorted `{ time, text }[]`
- [ ] 3. Find the active line for a given time
- [ ] 4. Wire to the playback clock with `requestAnimationFrame`
- [ ] 5. Verify sync at the start, middle and end of the song
