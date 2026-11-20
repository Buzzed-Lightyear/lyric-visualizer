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
1/60 s clock and a scripted audio track built from the first library
song's semantics (level follows section energy, steady 120 BPM beat), so
no audio file is needed. It first generates two made-up fixture songs
under `public/fixture/` (generated tone, invented lyrics, hand-written
semantics; gitignored) — with an empty library the harness renders
those, so verify passes with zero, one or many songs present. The app
smoke test runs on the fixtures (`?fixture=1` lists them in the picker):
it picks a song, plays, scrubs, opens the help sheet, presses every key,
goes back and switches songs, checking playback fully resets. It writes `shots/contact-sheet.png` (one
labeled tile per section plus an 8-frame filmstrip across every section
boundary) and `shots/report.json`, and fails on the checks defined in
`src/thresholds.ts`: blank tiles, differently labeled sections that look
alike, the two choruses not matching, semantics-off differing from the
neutral look, motion not rising with loudness (or freezing at silence),
single-frame jumps inside transitions, and draw time over budget. The
scene is deterministic (seeded randomness, no clock or window reads), so
repeats of a section render identically. Look at the contact sheet after
changing visuals; the checks catch regressions, not taste.

## The song library

One folder per song under `public/songs/<slug>/`:

- `audio.mp3` (or `.wav`, ...): the audio — gitignored
- `lyrics.lrc`: line-timed lyrics for that exact recording — gitignored
- `semantics.json`: the semantics and the song's look (committed; no
  lyric text, words go by index)
- `meta.json`: title, artist, album, duration, audio file name, and
  where the semantics came from (`api` / `agent` / `neutral`) — committed
- `words.json`: real word onsets from LRCLIB's word-synced lyrics, when
  the track has them — times only, so it is committed too

`public/songs/index.json` is generated from those folders (`npm run
index-songs`; add-song does it automatically) and is what the app loads
at startup. The start screen lists every song — title, artist, duration,
semantics source, and a strip of its section palette — and remembers the
last song played; `?song=<slug>` deep-links one. Preset choices in
`src/presetFeedback.json` are per song; bans are global.

## Adding a song

```sh
npm run add-song -- path/to/song.mp3
```

Reads title/artist/album/duration from the file's tags (override with
`--title`, `--artist`, `--album`, `--duration`, `--slug`), copies the
audio in, fetches synced lyrics from LRCLIB (exact `/api/get` first,
then `/api/search` accepting a duration within 2 s), saves per-word
timing when LRCLIB has it (the newer `lyricsfile` field), generates the
semantics, and rebuilds the index.

Rerunning on an existing song refuses to touch anything unless asked:

```sh
npm run add-song -- --song <slug> --lyrics            # refetch LRCLIB
npm run add-song -- --song <slug> --lyrics my.lrc     # use a local file
npm run add-song -- --song <slug> --semantics         # regenerate
npm run add-song -- --song <slug> --semantics --side  # to semantics.api.json + diff
npm run add-song -- --song <slug> --look              # rewrite only the look
```

`--side` writes next to the real file (gitignored), leaves
`semantics.json` untouched, and prints a diff: section boundaries side
by side, focus-word overlap, gesture agreement.

`--look` needs no lyrics and leaves sections and lines alone. On a file
without a look (or with a partial one) the model writes the
description, palette and voices from the title, the artist and the
existing sections, and the look is marked `"partial": true`; on a file
with a full look it keeps the words. Either way the scenes are chosen
again. To turn a partial look into a full version 3 file, regenerate
with the lyrics: `npm run add-song -- --song <slug> --lyrics --semantics`.

### Semantics from the API

Two calls (Anthropic TypeScript SDK, `scripts/generateSemantics.ts`;
the prompts, schemas, retries and checks are pure code in
`src/semanticsGen.ts` and `src/lookGen.ts`, tested against a mocked
model). The key comes from `ANTHROPIC_API_KEY` in `.env` (gitignored;
the SDK code is never imported by anything in the browser bundle).
`SEMANTICS_MODEL` overrides the default model (`claude-opus-5-5`).

1. **The semantics and the look.** The model reads the whole song and
   writes the version 3 file: the song-level look (a 1-3 sentence
   description in its own words, a palette, two of the eight type
   voices), the sections (free mood words, the four axes as numbers,
   energy, a palette within the song's, free imagery tags, a one-line
   scene, which voice) and the lines. The prompt offers no list of
   moods or imagery; the only closed lists are things the renderer can
   physically do (voices, gestures, directions). Output is
   schema-constrained, validated with the same parser the app uses and
   retried up to twice with the errors quoted back; the final document
   must pass the automatic checks in `src/semanticsChecks.ts` (sections
   cover the song, focus indices in range, gesture share between 15% and
   40%, same-label sections identical, refrain gestures consistent, no
   free-text field repeating four or more words in a row of a lyric
   line) or nothing is written.
2. **The model chooses the scenes.** With the look written, the model is
   shown every preset that may play (name, description, axes, imagery,
   colors), the song's sections, and the looks and preset sets of the
   songs already in the library, and chooses one preset per section
   label as one cohesive set for this song — and is asked to give the
   song its own identity next to the others. That is a request to the
   model; no code scores, penalizes or spreads presets. Code keeps
   guardrails only: names must exist; nothing banned, broken, blank or
   hard-strobing; no preset for two different labels. An invalid set is
   retried twice with the problems quoted back; if it is still invalid
   (or the call fails) the scorer picks instead and the file records it
   (`look.presetsFrom: "scorer"`).

Without a key, add-song writes a **neutral fallback** instead — a
version 2 file with sections from the gaps in the LRC, neutral mood, no
look and no authored gestures (the lexicon still fires at runtime; the
scorer picks the presets) — and says so.

## Keys

Press `?` in the player for this list. Space plays/pauses, `←`/`→` seek
5 s, and the on-screen transport has play/pause, a scrub bar with the
sections marked in their palette colors, back and fullscreen. Controls
fade out after a few idle seconds and return on mouse move or key press.

- `L`: show or hide the lyrics (physics text or the DOM line)
- `T`: physics text vs the old single DOM lyric line
- `B`: cycle the background — butterchurn / canvas scene / black
- `[` / `]`: previous / next ranked candidate for the current section
  (top 8); the choice is saved for that section label
- `N`: never show this preset again, then move to the next candidate
- `Shift+[` / `Shift+]`: browse the whole catalog (not saved)
- `G`: toggle gestures and focus words off and on (A/B against the pure
  section base motion)
- `E` / `H` / `X`: cycle the entrance / hold / exit part
- `F`: cycle the type voice; `Y`: cycle the layout
- `1`-`5`: force one of the original five combinations (slam, drop,
  float, tremble, swing); `0` returns everything to the mood mapping
- `D`: debug overlay — analysis bars, section, committed key, emphasis,
  background mode + preset name, the section's base motion (entrance,
  hold, exit, voice, anchor; forced overrides marked), and per line the
  focus indices, each gesture with whether it came from a direction or
  the lexicon, and refrain reuse
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

Named voices (family, weight, case, tracking, italic, word-space
factor), all OFL via Fontsource, loaded before the first frame: block
(Archivo Black), air (Inter Light), condensed (Anton), serif (Playfair
Display), whisper (Cormorant Garamond italic), mono (Space Mono),
marker (Permanent Marker), slab (Alfa Slab One).

### Typesetting

All spacing derives from each font's own measured metrics
(`src/voices.ts` measures them, `src/layout.ts` is pure math over them):

- **Word space** is the font's space advance times a per-voice factor
  (`VOICES[...].wordSpace`), plus the tracking — never a flat em
  fraction. A word's measured width excludes its trailing letter-space,
  so gaps and centering are optically even (the drawn glyph is shifted
  half a letter-space to recenter the ink).
- **Leading** comes from the font's real ascent + descent, times
  `typeset › leading` (`leadingCaps` for all-caps voices, which sit
  tighter).
- **Cap-height normalization**: each voice is size-adjusted so the same
  nominal size shows the same cap height (`typeset › capTarget`).
- **Balanced wrapping**: all partitions into up to 3 rows are scored for
  raggedness; a lone short word on the last row (an orphan) is rejected,
  and breaks at phrase boundaries (after punctuation, before
  conjunctions, prepositions and articles) are preferred
  (`phrasePenalty`, `rowPenalty`, `orphanFrac`).
- **Scale to target**: the fewest rows whose fitted size reaches the
  base size win; the widest row is scaled toward `targetWidthFrac` of
  the view — short lines scale up, long lines scale down — capped by
  `maxSizeFrac` and the safe margins (`marginX/Top/Bottom`) on every
  side.
- **Anchors**: three block positions — center, lower third, upper left
  (`centerY`, `lowY`, `upperLeftX/Y`). Each section uses one anchor for
  its whole length, from its mood.
- **Hierarchy**: focus words are set larger (`focusSize`) and heavier
  (`focusBold`, a same-color stroke), the rest smaller (`restSize`); the
  word space next to a bigger word follows the bigger size. In lockup a
  focus word gets its own row.

Layouts: centered (balanced wrapped rows), lockup (each row scaled to
one block width), focus (one word at a time, large — only when the
estimated pace is at or under 3 words/s with every word readable for
0.25 s, else it falls back to centered).

### Meaningful motion

Motion changes only when meaning changes:

- **Section grammar**: each section has one base entrance (from energy,
  calm to violent on the ladder), a hold and an anchor (from the
  section's axes: the nearest mood anchor, see below), an exit (the
  hold's natural one) and a voice, fixed for the whole section. Nothing
  varies per line for variety's sake.
- **Voices**: a song's two voices, main and accent, come from its look;
  each section says which one it is set in. Files without a look
  (versions 1 and 2) take both from the mood anchor, as before.
- **Axes, with the old moods as anchors** (`src/axes.ts`): motion and
  type are driven by the four axes (arousal, valence, tension, warmth),
  not by a mood word. The ten version 2 mood words (and "neutral")
  remain as anchor points in that space, each holding the hold, anchor,
  voices, jitter and lift it used to select. A version 3 section is
  placed by its own axes; a version 1 or 2 section sits exactly on its
  mood word's anchor, so old files map to exactly the result they always
  had. Jitter and lift blend between anchors by inverse distance (exact
  on an anchor, continuous everywhere); hold, anchor and the fallback
  voices come from the nearest anchor.
- **Refrains**: a line whose words repeat an earlier line (exact, a
  shorter reprise, or cut off mid-word with `-`) reuses that line's
  choreography exactly — grammar, focus and gesture — wherever it sits
  in the song (`src/choreo.ts`).
- **Directions** (semantics v2): a line may name `focus` word indices,
  a `gesture` from the fixed list, and an optional spatial `direction`.
  Focus words perform the gesture from their estimated onsets; all
  other words follow the section's base motion.
- **Lexicon fallback**: when a line has no direction, a ~45-stem English
  table (`src/gestures.ts` LEXICON, with inflection and g-dropping
  handling) puts the matched gesture on the matching word (at most two
  per line).
- Emphasis still scales strength, size, scrim and layout (focus at the
  top, lockup in the middle), and switches to the accent voice at
  >= 0.85. Audio still drives all ongoing forces.

### Gestures

Each is a recipe over the existing parts (no new physics): fall
(fall/rest, heavy landing), rise (buoy/bob), strike (slam/jolt), break
(arrives in shuddering pieces), drift (loose, barely held), tremble,
swell (grows past rest size), shrink (dwindles, goes still), rush
(whips in at speed; honors `direction`), halt (whips in and freezes),
apart (the letters pull apart and stay apart), together (letters fly in
and lock), echo (pulses with expanding ghost rings), hang
(hang/pendulum), linger (outstays its line's exit). Strengths live in
`tuning.ts` GESTURE_T.

**Word onsets** come from the song's `words.json` (real word timing from
LRCLIB) when a line has it; otherwise they are estimated — words spread
across the first ~70% of each line's duration (capped), weighted by word
length (src/onsets.ts). Each line falls back independently.

The harness renders a type specimen (every voice x every layout on the
same made-up line, with a focus word) and measures word gaps, margins,
row balance and orphans against `src/thresholds.ts`; films every
entrance, hold, exit, voice, layout and gesture; sweeps all entrance x
hold x exit combinations by introspection (no drawing) against the
legibility rules; verifies the debug overlay renders identically on a
deliberately polluted canvas context; and checks that no frame ever
drew text before the fonts were ready.

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

Picking, per section label, in this order:

1. **Your saved choice** ([ ] in the player), if it can still play.
2. **The look's preset** (`look.presets` in a version 3 file): the set
   the model chose for this song in add-song.
3. **The scorer**: every usable preset is scored per section (axes
   closeness, energy vs arousal and motion, palette vs dominant colors,
   imagery overlap through synonyms, readability, quality — weights in
   `tuning.ts` PRESET_SCORE). It is the fallback for files without a
   look and for a look preset that cannot play, and the source of the
   [ ] candidate list after the look's pick.

Guardrails, whoever decides: banned, broken, blank and hard-strobing
presets never play; same-label sections share one preset; automatic
picks never repeat on neighbouring sections; same inputs give the same
picks. Your [ ] / N feedback persists to `src/presetFeedback.json`
through a dev-only Vite endpoint (reset button in the K panel). Choices
are stored per song (keyed by slug); bans apply everywhere. The debug
overlay marks a pick `(saved)` or `(look)`.

## Does each song have its own look?

```sh
npm run look-report                      # before = the scorer alone
npm run look-report -- --before <ref>    # before = the library at a commit
npm run look-sheets                      # review/<slug>.jpg
```

`look-report` measures; nothing in it feeds back into picking. For the
library it prints the distinct presets per song, the presets every pair
of songs shares, how many distinct mood and imagery terms are in use,
each song's voices and palette, and the measured text readability of
the picked presets (the scorer weighs it; the model is not shown it) —
before and after. "Before" is the
library dressed by the scorer alone (looks ignored, voices from the mood
anchors: what every song got up to version 2), or, with `--before`, the
song files as they were at that commit. Saved choices are reported
separately, as overrides. `--out <file>` also writes the text.

`look-sheets` writes one contact sheet per song under `review/`: the
look description, the palette swatches, the two voices set in their own
faces (the title in main, the artist in accent), and for each section
label the 4-frame strip of its preset with the section's mood, axes,
imagery and scene. A saved choice that overrides the look is shown under
it. The strips come from `npm run catalog`; the sheets carry no lyric
text.

## Semantics file format

```json
{
  "version": 3,
  "look": {
    "description": "A slow amber evening that never quite turns to night.",
    "palette": ["#1a1206", "#e0a040", "#f4e2b8", "#7a3b1e"],
    "voices": { "main": "serif", "accent": "marker" },
    "presets": { "verse": "<preset name>", "hook": "<preset name>" },
    "presetsFrom": "model",
    "source": "api"
  },
  "sections": [
    {
      "start": 42.08, "end": 59.59,
      "label": "hook", "energy": 0.8,
      "mood": "sun-drunk, restless",
      "axes": { "arousal": 0.7, "valence": 0.6, "tension": 0.5, "warmth": 0.8 },
      "palette": ["#1a1206", "#e0a040", "#f4e2b8"],
      "imagery": ["paper lanterns", "warm dust"],
      "scene": "Lanterns sway over an empty courtyard at dusk.",
      "voice": "main"
    }
  ],
  "lines": [
    { "time": 42.08, "emphasis": 0.9,
      "focus": [1, 7], "gesture": "strike", "direction": "down" }
  ]
}
```

- `look` (version 3, one per song):
  - `description`: 1-3 sentences in the model's own words (at most 400
    characters).
  - `palette`: 3-6 hex colors for the whole song; section palettes vary
    within it.
  - `voices`: `main` and `accent`, two different voices out of block,
    air, condensed, serif, whisper, mono, marker, slab.
  - `presets`: the chosen background preset per section label.
    `presetsFrom` says who chose them (`model`, or `scorer` after the
    model's set failed the guardrails); `source` says who wrote the look
    (`api` / `agent`).
  - `partial: true` marks a look that was added to an older file without
    its lyrics: the sections are still version 2 shaped (no axes, scene
    or voice of their own; motion still follows their mood word).
- `start`/`end` in seconds; sections must not overlap.
- `energy` 0..1 scales baseline intensity (particle count, speed, glow).
- `mood`: version 3, a few free words (at most 48 characters) — any
  words work, because the renderer reads the axes. Versions 1 and 2, one
  short word: the ten known words sit on their anchors, anything else is
  neutral.
- `axes` (version 3): arousal (calm to intense), valence (dark and heavy
  to bright and uplifting), tension (smooth to harsh), warmth (cool to
  warm), each 0..1 — the same scale the preset catalog is tagged on.
  They drive the hold, the anchor, jitter and lift (`src/axes.ts`) and
  the scorer.
- `palette` is 3-5 hex colors: background, glow, particles, accent ring.
- `imagery`: version 3, up to 6 free tags (at most 32 characters each).
  For the canvas scene the first tag with a motif wins, matched as a
  whole tag or (version 3 only) by its words; unknown tags fall through
  to haze. Motifs: **embers** (rise from the bottom, flicker, cool as
  they climb, heat glow along the bottom), **rain** (long angled streaks
  in depth layers, dim glow high up), **stars** (fixed field with slow
  parallax, twinkle from high, soft horizon glow), **haze** (large
  drifting blobs and blurred bokeh lights; smoke, city-night,
  streetlights, fluorescent land here), and **drift** (the step 2 look,
  used only for neutral).
- `scene` (version 3): one line describing the section's scene (at most
  160 characters).
- `voice` (version 3): `main` or `accent` — which of the look's two
  voices the section is set in. Lines at emphasis 0.85 or above use the
  accent voice.
- `lines` map an LRC start time to emphasis 0..1: how hard beat accents
  land during that line. Unlisted lines default to 0.5.
- Per-line directions (version 2 and up); the file still contains
  **no lyric text** — words go by 0-based index:
  - `focus`: 1-2 distinct indices of the words that carry the line
    (set larger and heavier; they perform the gesture).
  - `gesture`: one of fall, rise, strike, break, drift, tremble, swell,
    shrink, rush, halt, apart, together, echo, hang, linger (needs
    `focus`).
  - `direction`: left / right / up / down, a spatial hint for sided
    gestures (needs `gesture`).
  - Unknown line fields are rejected so lyric text can never slip in
    (in version 3 so are unknown section and look fields, and the free
    text is length-limited); focus indices are range-checked against the
    loaded lyrics at runtime (console errors, `validateFocusRanges`).

The file is validated on load; problems are listed in the console and the
scene runs neutral. **Version 1 and 2 files still parse and render
exactly as before**: they have no look, the version 3 section fields are
never read from them, their presets come from the scorer and their
voices from the mood word.

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
- **Step 4, LLM extraction: built** (`npm run add-song -- --song <slug>
  --semantics --side` regenerates to a side file and prints the diff
  against the hand-written annotation).
- **Semantics version 3: built.** Each song gets its own look from the
  model: free mood and imagery, axes as numbers, a song-level look with
  its two voices, and the model's choice of presets as one set per song
  (`npm run look-report`, `npm run look-sheets`). The six library songs
  currently carry **partial** looks (written without lyrics); one
  command each regenerates them in full.
- **Songs pass: done.** A real library (one folder per song), add-song
  with LRCLIB lyrics + word timing, a start screen, and a proper
  transport replacing the native audio controls.
- Next (provisional): step 5, persistence + presets and seeds.

Analysis (`src/analysis.ts` for the Web Audio graph, `src/audioMath.ts`
for the spectrum math on plain arrays), mapping (`src/mapping.ts`) and
rendering (`src/scene.ts` orchestrating the motif renderers in
`src/motifs.ts`) are separate: the renderer sees only
`(AudioFrame, SceneParams, dt)`. The semantic schema and its validation
live in `src/semantics.ts`; the axes and their mood anchors in
`src/axes.ts`. All tuning constants live in `src/tuning.ts`;
verify thresholds in `src/thresholds.ts`.
