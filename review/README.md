# Look review

Generated files for reviewing each song's look by eye. Nothing here is
read by the app.

- `<slug>.jpg` — one contact sheet per song (`npm run look-sheets`): the
  look description, the song palette, the two type voices in their own
  faces, and for each section label the four frames of its preset
  (quiet · loud · on a beat · later). On every frame the song title is
  drawn by the real text layer with its readability treatment, and the
  scene's measured contrast is printed under the frames: adaptive text
  against the old scrim. Presets the image review swapped in are marked.
- `look-report.txt` — `npm run look-report -- --before 7a7f4df`: the
  library before and after it had looks.
- `readability.txt` — the per-song, per-scene table `npm run shots`
  prints: the share of contrast samples at 3:1 or better and the median
  ratio, old scrim against adaptive text.

The frames come from `npm run catalog` (gitignored `catalog-strips/`)
when the strips are on disk, and are rendered on the spot otherwise. The
sheets and the reports carry no lyric text.

The six looks in this folder are **partial**: they were written without
the lyrics, from each song's title, artist and existing sections. Their
presets were first chosen from the catalog's text descriptions and then
reviewed against the strips (12 of 41 were swapped).
