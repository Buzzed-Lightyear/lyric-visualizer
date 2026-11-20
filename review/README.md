# Look review

Generated files for reviewing each song's look by eye. Nothing here is
read by the app.

- `<slug>.jpg` — one contact sheet per song (`npm run look-sheets`): the
  look description, the song palette, the two type voices in their own
  faces, and for each section label the 4-frame strip of the preset the
  look chose (quiet · loud · on a beat · later). Where one of your saved
  choices plays instead, it is shown underneath.
- `look-report.txt` — `npm run look-report -- --before 7a7f4df`: the
  library before and after it had looks.

The strips come from `npm run catalog` (gitignored `catalog-strips/`),
so regenerate those first on a machine that has never run it. The sheets
and the report carry no lyric text.

The six looks in this folder are **partial**: they were written without
the lyrics, from each song's title, artist and existing sections, and
the presets were chosen from the catalog's text descriptions alone. The
sheets are where to check those choices against the pixels.
