/**
 * The song library: one folder per song under public/songs/<slug>/ holding
 * the audio, lyrics.lrc, semantics.json, meta.json and (when LRCLIB had
 * word timing) words.json. Audio, lyrics and generated side files are
 * gitignored; semantics, meta, words and the generated index are committed
 * and carry no lyric text.
 *
 * This module is pure (no fs, no fetch) so both the app and the Node
 * scripts share one source of truth for slugs, meta and the index format.
 */

import type { Semantics } from './semantics'

/** Who produced a song's semantics file. */
export type SemanticsSource = 'api' | 'agent' | 'neutral'

export const SEMANTICS_SOURCES: readonly SemanticsSource[] = ['api', 'agent', 'neutral']

/** public/songs/<slug>/meta.json */
export interface SongMeta {
  title: string
  artist: string
  album: string
  /** Seconds. */
  duration: number
  /** Audio file name inside the song folder, e.g. "audio.mp3". */
  audio: string
  semantics: SemanticsSource
}

/** One row of the generated public/songs/index.json. */
export interface SongEntry extends SongMeta {
  slug: string
  /** URL prefix the song's files load from, e.g. "/songs/<slug>/". */
  base: string
  /** One accent color per section, for the library's palette strips. */
  colors: string[]
}

export interface SongIndex {
  version: 1
  songs: SongEntry[]
}

/** "Söme Artist", "Track (feat. X)!" -> "some-artist-track-feat-x" */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function songSlug(artist: string, title: string): string {
  const slug = slugify(`${artist} ${title}`)
  return slug || 'untitled'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validate a parsed meta.json. */
export function parseMeta(input: unknown): { meta: SongMeta | null; errors: string[] } {
  const errors: string[] = []
  if (!isRecord(input)) return { meta: null, errors: ['meta.json must be an object'] }
  for (const key of ['title', 'artist', 'album', 'audio'] as const) {
    if (typeof input[key] !== 'string') errors.push(`"${key}" must be a string`)
  }
  if (typeof input.duration !== 'number' || !(input.duration > 0)) {
    errors.push('"duration" must be a number of seconds > 0')
  }
  if (!SEMANTICS_SOURCES.includes(input.semantics as SemanticsSource)) {
    errors.push(`"semantics" must be one of ${SEMANTICS_SOURCES.join(', ')}`)
  }
  return errors.length > 0 ? { meta: null, errors } : { meta: input as unknown as SongMeta, errors }
}

/** One accent per section (the second palette color, falling back to the first). */
export function sectionColors(semantics: Semantics | null): string[] {
  if (!semantics) return []
  return semantics.sections.map((s) => s.palette[1] ?? s.palette[0] ?? '#5a6b8f')
}

export function indexEntry(slug: string, meta: SongMeta, semantics: Semantics | null): SongEntry {
  return { slug, base: `/songs/${slug}/`, ...meta, colors: sectionColors(semantics) }
}

export function buildIndex(entries: SongEntry[]): SongIndex {
  return {
    version: 1,
    songs: [...entries].sort((a, b) =>
      `${a.artist} ${a.title}`.localeCompare(`${b.artist} ${b.title}`),
    ),
  }
}

/**
 * Parse a loaded index.json tolerantly: bad rows are skipped so one broken
 * entry never takes the whole library down.
 */
export function parseIndex(input: unknown): SongEntry[] {
  if (!isRecord(input) || !Array.isArray(input.songs)) return []
  const entries: SongEntry[] = []
  for (const raw of input.songs) {
    if (!isRecord(raw) || typeof raw.slug !== 'string' || raw.slug === '') continue
    const { meta } = parseMeta(raw)
    if (!meta) continue
    const colors = Array.isArray(raw.colors)
      ? raw.colors.filter((c: unknown): c is string => typeof c === 'string')
      : []
    const base = typeof raw.base === 'string' && raw.base !== '' ? raw.base : `/songs/${raw.slug}/`
    entries.push({ slug: raw.slug, base, ...meta, colors })
  }
  return entries
}

/** 125.4 -> "2:05", for durations and playback positions. */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// --- word timing (words.json) ------------------------------------------------

/**
 * public/songs/<slug>/words.json: real word onsets from LRCLIB's word-synced
 * lyrics. Times only, by line start time — no lyric text, so it is committed.
 */
export interface WordTimes {
  version: 1
  lines: { time: number; onsets: number[] }[]
}

export function parseWordTimes(input: unknown): WordTimes | null {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.lines)) return null
  const lines: WordTimes['lines'] = []
  for (const raw of input.lines) {
    if (!isRecord(raw) || typeof raw.time !== 'number' || !Array.isArray(raw.onsets)) return null
    if (raw.onsets.some((o: unknown) => typeof o !== 'number')) return null
    lines.push({ time: raw.time, onsets: raw.onsets as number[] })
  }
  return { version: 1, lines }
}

/**
 * Real onsets for the lyric line starting at `lineTime`, or null when the
 * file has no matching entry or the word count disagrees (then the caller
 * falls back to estimated onsets).
 */
export function onsetsForLine(
  words: WordTimes | null,
  lineTime: number,
  wordCount: number,
): number[] | null {
  if (!words) return null
  for (const line of words.lines) {
    if (Math.abs(line.time - lineTime) < 0.75 && line.onsets.length === wordCount) {
      return line.onsets
    }
  }
  return null
}
