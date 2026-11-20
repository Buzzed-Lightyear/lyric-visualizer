/**
 * npm run add-song -- <audio file> [options]
 * npm run add-song -- --song <slug> [--lyrics [path]] [--semantics [--side]]
 *
 * Adds a song to the library (public/songs/<slug>/): reads the tags, copies
 * the audio in, fetches synced lyrics from LRCLIB (word timing included
 * when they have it), gets semantics from the API (or writes the neutral
 * fallback without a key), and rebuilds the song index.
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
 */

import fs from 'node:fs'
import path from 'node:path'
import { parseFile } from 'music-metadata'
import { songSlug, type SemanticsSource, type SongMeta } from '../src/library'
import { parseLrc, type LyricLine } from '../src/lrc'
import { parseLyricsfile, parseTrack, pickSearchResult, wordTimesForLrc } from '../src/lrclib'
import { diffReport, neutralSemantics } from '../src/semanticsChecks'
import { parseSemantics } from '../src/semantics'
import { extractionInput, generateSemantics } from './generateSemantics'
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

/** Generate (API or neutral fallback); returns the semantics source used. */
async function makeSemantics(
  dir: string,
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
    const result = await generateSemantics(input, lrcLines)
    if (!result.doc) {
      console.error('semantics generation failed; NOT writing a bad file:')
      for (const error of result.errors) console.error(`  - ${error}`)
      summary.push('semantics: generation FAILED (nothing written)')
      return null
    }
    doc = result.doc
    source = 'api'
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
    if (!args.lyrics && !args.semantics) {
      fail(
        `"${slug}" already exists. Nothing is overwritten unless you ask:\n` +
          `  --lyrics [path]   refresh the lyrics (and word timing)\n` +
          `  --semantics       regenerate the semantics (add --side to keep the current file)`,
      )
    }
    const metaRaw = readJson(path.join(dir, 'meta.json')) as SongMeta
    console.log(`refreshing ${slug} ("${metaRaw.title}")`)
    if (args.lyrics === 'fetch') await fetchLyrics(dir, metaRaw, summary)
    else if (args.lyrics) importLocalLyrics(dir, args.lyrics, summary)
    if (args.semantics) {
      const source = await makeSemantics(dir, metaRaw, args.side, summary)
      if (source) writeJson(path.join(dir, 'meta.json'), { ...metaRaw, semantics: source })
    }
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
    const source = await makeSemantics(dir, meta, args.side, summary)
    if (source) meta.semantics = source
    writeJson(path.join(dir, 'meta.json'), meta)
  }

  const songs = rebuildIndex()
  summary.push(`index: ${songs.length} song(s)`)
  console.log('\ndone:')
  for (const line of summary) console.log(`  ${line}`)
}

await main()
