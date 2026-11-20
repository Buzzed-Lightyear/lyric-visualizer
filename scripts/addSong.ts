/**
 * npm run add-song -- <audio file> [options]
 * npm run add-song -- --song <slug> [--lyrics [path]] [--semantics [--side]] [--look]
 *
 * Adds a song to the library (public/songs/<slug>/): reads the tags, copies
 * the audio in, fetches synced lyrics from LRCLIB (word timing included
 * when they have it), gets semantics from the API (or writes the neutral
 * fallback without a key), and rebuilds the song index.
 *
 * With a key the model does two things: it reads the song and writes the
 * version 3 semantics with the song's look; then, shown every usable
 * preset and the looks of the songs already in the library, it chooses
 * one preset per section label as one set for this song.
 *
 * Rerunning on an existing song refreshes only what the flags ask for and
 * never overwrites anything silently.
 *
 * Options:
 *   --title/--artist/--album <text>, --duration <sec>   override the tags
 *   --slug <slug>       choose the folder name
 *   --lyrics [path]     use a local .lrc (or, with no path, refetch LRCLIB)
 *   --semantics         (re)generate the semantics file
 *   --side              write semantics to semantics.api.json instead and
 *                       print a diff against the existing semantics.json
 *   --look              rewrite only the look of an existing semantics file:
 *                       no lyrics needed, sections and lines stay as they are
 */

import fs from 'node:fs'
import path from 'node:path'
import { parseFile } from 'music-metadata'
import { parseMeta, songSlug, type SemanticsSource, type SongMeta } from '../src/library'
import { choosePresets, libraryLook, withLook, writeLookOnly, type LibraryLook } from '../src/lookGen'
import { parseLrc, type LyricLine } from '../src/lrc'
import { parseLyricsfile, parseTrack, pickSearchResult, wordTimesForLrc } from '../src/lrclib'
import { feedbackFor, parseFeedbackFile, type Feedback } from '../src/presetPick'
import { diffReport, neutralSemantics } from '../src/semanticsChecks'
import { parseSemantics, type SongLook } from '../src/semantics'
import { apiAsk, extractionInput, generateSemantics } from './generateSemantics'
import { rebuildIndex, SONGS_DIR } from './songIndex'

const LRCLIB = 'https://lrclib.net'
// Identifies the client to LRCLIB, as their docs ask. No personal details.
const USER_AGENT = 'lyric-visualizer (personal hobby project)'

interface Args {
  audioPath: string | null
  song: string | null
  slug: string | null
  title: string | null
  artist: string | null
  album: string | null
  duration: number | null
  /** 'fetch' = refetch LRCLIB; a string = local .lrc path. */
  lyrics: 'fetch' | string | null
  semantics: boolean
  side: boolean
  look: boolean
}

function parseArgsList(argv: string[]): Args {
  const args: Args = {
    audioPath: null,
    song: null,
    slug: null,
    title: null,
    artist: null,
    album: null,
    duration: null,
    lyrics: null,
    semantics: false,
    side: false,
    look: false,
  }
  const takesValue = new Set(['--song', '--slug', '--title', '--artist', '--album', '--duration'])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (takesValue.has(arg)) {
      const value = argv[++i]
      if (value === undefined) fail(`${arg} needs a value`)
      if (arg === '--duration') args.duration = Number(value)
      else args[arg.slice(2) as 'song' | 'slug' | 'title' | 'artist' | 'album'] = value
    } else if (arg === '--lyrics') {
      // Optional value: a path refreshes from a local file, none refetches.
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args.lyrics = next
        i++
      } else {
        args.lyrics = 'fetch'
      }
    } else if (arg === '--semantics') {
      args.semantics = true
    } else if (arg === '--side') {
      args.side = true
    } else if (arg === '--look') {
      args.look = true
    } else if (!arg.startsWith('--') && args.audioPath === null) {
      args.audioPath = arg
    } else {
      fail(`unknown argument "${arg}"`)
    }
  }
  return args
}

function fail(message: string): never {
  console.error(`add-song: ${message}`)
  process.exit(1)
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
}

async function lrclibFetch(pathname: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(pathname, LRCLIB)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (response.status === 404) return null
  if (!response.ok) fail(`LRCLIB answered ${response.status} for ${pathname}`)
  return (await response.json()) as unknown
}

/** Fetch lyrics for the song; write lyrics.lrc (+ words.json). */
async function fetchLyrics(dir: string, meta: SongMeta, summary: string[]): Promise<void> {
  console.log(`fetching lyrics from LRCLIB...`)
  let track = parseTrack(
    await lrclibFetch('/api/get', {
      artist_name: meta.artist,
      track_name: meta.title,
      album_name: meta.album,
      duration: String(Math.round(meta.duration)),
    }),
  )
  if (!track?.syncedLyrics) {
    console.log('  no exact match; searching...')
    const results = await lrclibFetch('/api/search', {
      track_name: meta.title,
      artist_name: meta.artist,
    })
    track = pickSearchResult(results, meta.duration)
  }
  if (!track?.syncedLyrics) {
    summary.push('lyrics: NOT FOUND on LRCLIB')
    console.log(
      '  nothing matched (needs synced lyrics within 2s of the duration).\n' +
        `  If you have a local file: npm run add-song -- --song <slug> --lyrics <path/to/file.lrc>`,
    )
    return
  }
  fs.writeFileSync(path.join(dir, 'lyrics.lrc'), track.syncedLyrics + '\n')
  const lrcLines = parseLrc(track.syncedLyrics)
  summary.push(`lyrics: LRCLIB #${track.id} "${track.trackName}" (${lrcLines.length} timed lines)`)

  if (track.lyricsfile) {
    const parsed = parseLyricsfile(track.lyricsfile)
    const words = parsed ? wordTimesForLrc(lrcLines, parsed) : null
    if (words && words.lines.length > 0) {
      writeJson(path.join(dir, 'words.json'), words)
      summary.push(
        `word timing: ${words.lines.length} of ${lrcLines.filter((l) => l.text.trim()).length} lines word-synced (words.json)`,
      )
    } else {
      summary.push('word timing: lyricsfile present but could not be aligned; using estimates')
    }
  } else {
    summary.push('word timing: not available for this track; using estimates')
  }
}

function importLocalLyrics(dir: string, source: string, summary: string[]): void {
  const text = fs.readFileSync(source, 'utf8')
  const lines = parseLrc(text)
  if (lines.length === 0) fail(`${source} has no timed LRC lines`)
  fs.writeFileSync(path.join(dir, 'lyrics.lrc'), text)
  summary.push(`lyrics: imported from ${source} (${lines.length} timed lines)`)
}

function loadLrc(dir: string): LyricLine[] {
  const file = path.join(dir, 'lyrics.lrc')
  return fs.existsSync(file) ? parseLrc(fs.readFileSync(file, 'utf8')) : []
}

/** Global bans plus this song's saved choices, from src/presetFeedback.json. */
function loadFeedback(slug: string): Feedback {
  const file = path.resolve('src/presetFeedback.json')
  const parsed = parseFeedbackFile(fs.existsSync(file) ? readJson(file) : null)
  return feedbackFor(parsed, slug)
}

/**
 * The other songs in the library as the model is shown them: each one's
 * look (when it has one) and the presets it plays. Carries no lyric text.
 */
function libraryContext(exceptSlug: string): LibraryLook[] {
  const looks: LibraryLook[] = []
  if (!fs.existsSync(SONGS_DIR)) return looks
  for (const name of fs.readdirSync(SONGS_DIR).sort()) {
    if (name === exceptSlug) continue
    const metaFile = path.join(SONGS_DIR, name, 'meta.json')
    const semanticsFile = path.join(SONGS_DIR, name, 'semantics.json')
    if (!fs.existsSync(metaFile) || !fs.existsSync(semanticsFile)) continue
    const { meta } = parseMeta(readJson(metaFile))
    const { semantics } = parseSemantics(readJson(semanticsFile))
    // A neutral-fallback song has no look of its own to stand next to.
    if (!meta || !semantics || meta.semantics === 'neutral') continue
    looks.push(libraryLook(meta, semantics.sections, semantics.look ?? null, loadFeedback(name)))
  }
  return looks
}

function reportScenes(
  result: { from: 'model' | 'scorer'; presets: Record<string, string>; problems: string[] },
  summary: string[],
): void {
  const count = Object.keys(result.presets).length
  if (result.from === 'model') {
    summary.push(`scenes: ${count} presets chosen by the model as one set`)
  } else {
    summary.push(
      `scenes: the model's set stayed invalid, so the SCORER picked ${count} presets ` +
        `(recorded as look.presetsFrom "scorer"): ${result.problems.slice(0, 2).join('; ')}`,
    )
  }
}

/**
 * --look: rewrite only the look of an existing semantics file. A file
 * without a look (or with a partial one) gets a description, palette and
 * voices written from its sections, title and artist — marked partial,
 * because its sections keep their old shape. A full look keeps its words.
 * Either way the model then chooses the scenes again.
 */
async function makeLook(dir: string, slug: string, meta: SongMeta, summary: string[]): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) fail('--look needs ANTHROPIC_API_KEY in .env')
  if (meta.semantics === 'neutral') {
    fail('this song has the neutral fallback; run --semantics first (a look needs real sections)')
  }
  const file = path.join(dir, 'semantics.json')
  if (!fs.existsSync(file)) fail(`no semantics.json for ${slug}; run --semantics first`)
  const raw = readJson(file)
  const { semantics, errors } = parseSemantics(raw)
  if (!semantics) fail(`semantics.json is invalid: ${errors.slice(0, 3).join('; ')}`)

  const ask = apiAsk()
  const feedback = loadFeedback(slug)
  let draft: Pick<SongLook, 'description' | 'palette' | 'voices'>
  let kept: Pick<SongLook, 'source' | 'partial'>
  if (semantics.look && !semantics.look.partial) {
    console.log('keeping the look as written; choosing the scenes again...')
    draft = semantics.look
    kept = { source: semantics.look.source }
  } else {
    console.log('writing a look from the existing sections (no lyrics)...')
    const written = await writeLookOnly(
      { title: meta.title, artist: meta.artist, durationSec: meta.duration, sections: semantics.sections },
      ask,
      console.log,
    )
    if (!written.look) {
      console.error('could not write a look; nothing changed:')
      for (const error of written.errors) console.error(`  - ${error}`)
      summary.push('look: FAILED (nothing written)')
      return
    }
    draft = written.look
    kept = { source: 'api', partial: true }
  }
  console.log('choosing the scenes...')
  const chosen = await choosePresets(
    {
      title: meta.title,
      artist: meta.artist,
      look: draft,
      sections: semantics.sections,
      feedback,
      library: libraryContext(slug),
    },
    ask,
    console.log,
  )
  const look: SongLook = {
    description: draft.description,
    palette: draft.palette,
    voices: draft.voices,
    presets: chosen.presets,
    presetsFrom: chosen.from,
    ...(kept.source ? { source: kept.source } : {}),
    ...(kept.partial ? { partial: true } : {}),
  }
  const next = withLook(raw, look)
  const check = parseSemantics(next)
  if (!check.semantics) {
    console.error('the new look does not validate; nothing changed:')
    for (const error of check.errors) console.error(`  - ${error}`)
    summary.push('look: FAILED (nothing written)')
    return
  }
  writeJson(file, next)
  summary.push(
    kept.partial
      ? 'look: written from the existing sections (partial: rerun --semantics with lyrics for the full version 3 file)'
      : 'look: kept as written',
  )
  reportScenes(chosen, summary)
}

/** Generate (API or neutral fallback); returns the semantics source used. */
async function makeSemantics(
  dir: string,
  slug: string,
  meta: SongMeta,
  side: boolean,
  summary: string[],
): Promise<SemanticsSource | null> {
  const lrcLines = loadLrc(dir)
  const target = path.join(dir, side ? 'semantics.api.json' : 'semantics.json')
  let doc: unknown = null
  let source: SemanticsSource = 'neutral'

  if (process.env.ANTHROPIC_API_KEY) {
    console.log('generating semantics with the API...')
    if (lrcLines.filter((line) => line.text.trim()).length === 0) {
      fail('no lyrics to annotate; add lyrics first')
    }
    const input = extractionInput(meta.title, meta.artist, meta.duration, lrcLines)
    const result = await generateSemantics(input, lrcLines, {
      feedback: loadFeedback(slug),
      library: libraryContext(slug),
    })
    if (!result.doc) {
      console.error('semantics generation failed; NOT writing a bad file:')
      for (const error of result.errors) console.error(`  - ${error}`)
      summary.push('semantics: generation FAILED (nothing written)')
      return null
    }
    doc = result.doc
    source = 'api'
    if (result.presets) reportScenes(result.presets, summary)
  } else {
    console.log(
      'no ANTHROPIC_API_KEY in .env: writing the NEUTRAL fallback\n' +
        '  (sections from the gaps in the LRC, neutral mood, lexicon gestures only).\n' +
        '  Set the key and rerun with --semantics for the real thing.',
    )
    doc = neutralSemantics(lrcLines, meta.duration)
  }

  if (side) {
    writeJson(target, doc)
    summary.push(`semantics: ${source} -> semantics.api.json (side file; semantics.json untouched)`)
    const existingFile = path.join(dir, 'semantics.json')
    if (fs.existsSync(existingFile)) {
      const existing = parseSemantics(readJson(existingFile)).semantics
      const generated = parseSemantics(doc).semantics
      if (existing && generated) {
        console.log('\ndiff against the existing semantics.json:')
        for (const line of diffReport(existing, generated)) console.log(`  ${line}`)
      }
    }
    return null // meta keeps its current source
  }
  writeJson(target, doc)
  summary.push(`semantics: ${source}`)
  return source
}

async function main(): Promise<void> {
  if (fs.existsSync('.env')) process.loadEnvFile('.env')
  const args = parseArgsList(process.argv.slice(2))
  const summary: string[] = []

  // Refresh mode: --song <slug>, or a bare slug that names an existing song.
  const asSlug = args.song ?? args.audioPath
  const refreshDir = asSlug ? path.join(SONGS_DIR, asSlug) : null
  const refreshing =
    refreshDir !== null &&
    fs.existsSync(path.join(refreshDir, 'meta.json')) &&
    (args.song !== null || !fs.existsSync(args.audioPath ?? ''))

  if (refreshing) {
    const slug = asSlug!
    const dir = refreshDir!
    if (!args.lyrics && !args.semantics && !args.look) {
      fail(
        `"${slug}" already exists. Nothing is overwritten unless you ask:\n` +
          `  --lyrics [path]   refresh the lyrics (and word timing)\n` +
          `  --semantics       regenerate the semantics (add --side to keep the current file)\n` +
          `  --look            rewrite only the look (no lyrics needed)`,
      )
    }
    if (args.look && args.semantics) fail('--semantics already writes the look; drop --look')
    const metaRaw = readJson(path.join(dir, 'meta.json')) as SongMeta
    console.log(`refreshing ${slug} ("${metaRaw.title}")`)
    if (args.lyrics === 'fetch') await fetchLyrics(dir, metaRaw, summary)
    else if (args.lyrics) importLocalLyrics(dir, args.lyrics, summary)
    if (args.semantics) {
      const source = await makeSemantics(dir, slug, metaRaw, args.side, summary)
      if (source) writeJson(path.join(dir, 'meta.json'), { ...metaRaw, semantics: source })
    }
    if (args.look) await makeLook(dir, slug, metaRaw, summary)
  } else {
    // New song from an audio file.
    if (!args.audioPath) fail('usage: npm run add-song -- <audio file> [options]')
    if (!fs.existsSync(args.audioPath)) fail(`no file at ${args.audioPath}`)
    console.log(`reading tags from ${path.basename(args.audioPath)}...`)
    const tags = await parseFile(args.audioPath)
    const meta: SongMeta = {
      title: args.title ?? tags.common.title ?? path.parse(args.audioPath).name,
      artist: args.artist ?? tags.common.artist ?? 'Unknown artist',
      album: args.album ?? tags.common.album ?? '',
      duration: args.duration ?? Number((tags.format.duration ?? 0).toFixed(1)),
      audio: `audio${path.extname(args.audioPath).toLowerCase() || '.mp3'}`,
      semantics: 'neutral',
    }
    if (!(meta.duration > 0)) fail('could not read a duration from the tags; pass --duration <sec>')
    const slug = args.slug ?? songSlug(meta.artist, meta.title)
    const dir = path.join(SONGS_DIR, slug)
    if (fs.existsSync(dir)) {
      fail(
        `public/songs/${slug}/ already exists. To refresh it:\n` +
          `  npm run add-song -- --song ${slug} --lyrics\n` +
          `  npm run add-song -- --song ${slug} --semantics`,
      )
    }
    console.log(`adding "${meta.title}" by ${meta.artist} as ${slug}`)
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(args.audioPath, path.join(dir, meta.audio))
    summary.push(`audio: ${meta.audio} (${(fs.statSync(args.audioPath).size / 1e6).toFixed(1)} MB)`)

    if (typeof args.lyrics === 'string' && args.lyrics !== 'fetch') {
      importLocalLyrics(dir, args.lyrics, summary)
    } else {
      await fetchLyrics(dir, meta, summary)
    }
    const source = await makeSemantics(dir, slug, meta, args.side, summary)
    if (source) meta.semantics = source
    writeJson(path.join(dir, 'meta.json'), meta)
  }

  const songs = rebuildIndex()
  summary.push(`index: ${songs.length} song(s)`)
  console.log('\ndone:')
  for (const line of summary) console.log(`  ${line}`)
}

await main()
