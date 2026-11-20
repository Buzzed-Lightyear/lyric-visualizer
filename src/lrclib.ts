/**
 * LRCLIB response handling (https://lrclib.net). Pure functions only; the
 * actual fetching lives in scripts/addSong.ts. Covers the /api/get and
 * /api/search JSON shapes, plus the word-synced "lyricsfile" field: a small
 * YAML document with per-word start_ms values. Only the times are read —
 * the lyric text never leaves the parser, so nothing here can leak words
 * into committed files.
 */

import type { LyricLine } from './lrc'
import type { WordTimes } from './library'

export interface LrclibTrack {
  id: number
  trackName: string
  artistName: string
  albumName: string
  /** Seconds. */
  duration: number
  instrumental: boolean
  syncedLyrics: string | null
  plainLyrics: string | null
  /** Newer field: word-synced lyrics as a YAML document. */
  lyricsfile: string | null
  hasWordSync: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validate one track object from /api/get or a /api/search row. */
export function parseTrack(input: unknown): LrclibTrack | null {
  if (!isRecord(input)) return null
  if (typeof input.id !== 'number' || typeof input.duration !== 'number') return null
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const strOrNull = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null)
  return {
    id: input.id,
    trackName: str(input.trackName),
    artistName: str(input.artistName),
    albumName: str(input.albumName),
    duration: input.duration,
    instrumental: input.instrumental === true,
    syncedLyrics: strOrNull(input.syncedLyrics),
    plainLyrics: strOrNull(input.plainLyrics),
    lyricsfile: strOrNull(input.lyricsfile),
    hasWordSync: input.hasWordSync === true,
  }
}

/**
 * Choose from /api/search results: the first track with synced lyrics whose
 * duration is within `toleranceSec` of ours.
 */
export function pickSearchResult(
  results: unknown,
  durationSec: number,
  toleranceSec = 2,
): LrclibTrack | null {
  if (!Array.isArray(results)) return null
  for (const raw of results) {
    const track = parseTrack(raw)
    if (!track || !track.syncedLyrics) continue
    if (Math.abs(track.duration - durationSec) <= toleranceSec) return track
  }
  return null
}

// --- lyricsfile (word timing) --------------------------------------------------

interface ParsedLine {
  /** Line start, seconds. */
  time: number
  /** One onset per word, seconds. */
  onsets: number[]
}

/**
 * Pull the word timing out of a "lyricsfile" document. The document is
 * YAML, but only the structure matters here: entries under "lines:" open
 * with "- text:", carry a "start_ms:" and a "words:" list whose entries
 * open with a deeper-indented "- text:" plus their own "start_ms:". The
 * text values are never parsed — indentation and the start_ms numbers are
 * enough — which sidesteps YAML string quoting entirely.
 *
 * Returns null when the document doesn't look like that shape.
 */
export function parseLyricsfile(source: string): ParsedLine[] | null {
  const lines: { startMs: number | null; wordMs: number[] }[] = []
  let inLines = false
  let lineIndent = -1
  let current: { startMs: number | null; wordMs: number[] } | null = null
  /** Whether the last "- text:" opened a word entry (vs a line entry). */
  let lastWasWord = false

  for (const raw of source.split(/\r?\n/)) {
    if (/^lines:\s*$/.test(raw)) {
      inLines = true
      continue
    }
    if (!inLines) continue
    const entry = /^(\s*)- text:/.exec(raw)
    if (entry) {
      const indent = entry[1].length
      if (lineIndent < 0) lineIndent = indent
      if (indent === lineIndent) {
        current = { startMs: null, wordMs: [] }
        lines.push(current)
        lastWasWord = false
      } else if (indent > lineIndent && current) {
        current.wordMs.push(Number.NaN)
        lastWasWord = true
      }
      continue
    }
    const start = /^\s*start_ms:\s*(\d+)\s*$/.exec(raw)
    if (start && current) {
      const ms = Number(start[1])
      if (lastWasWord) {
        if (current.wordMs.length > 0) current.wordMs[current.wordMs.length - 1] = ms
      } else if (current.startMs === null) {
        current.startMs = ms
      }
    }
  }

  if (lines.length === 0) return null
  const parsed: ParsedLine[] = []
  for (const line of lines) {
    if (line.startMs === null) continue
    const onsets = line.wordMs.filter((ms) => Number.isFinite(ms)).map((ms) => ms / 1000)
    if (onsets.length !== line.wordMs.length) continue // a word without a time: drop the line
    parsed.push({ time: line.startMs / 1000, onsets })
  }
  return parsed.length > 0 ? parsed : null
}

/**
 * Align parsed word timing with the LRC lines the app will actually show.
 * A line matches when the start times are within 1s and the word counts
 * agree; everything else is left out (the app falls back to estimates).
 */
export function wordTimesForLrc(lrcLines: readonly LyricLine[], parsed: ParsedLine[]): WordTimes {
  const out: WordTimes = { version: 1, lines: [] }
  for (const line of lrcLines) {
    const wordCount = line.text.split(/\s+/).filter(Boolean).length
    if (wordCount === 0) continue
    let best: ParsedLine | null = null
    let bestDiff = 1
    for (const candidate of parsed) {
      const diff = Math.abs(candidate.time - line.time)
      if (diff < bestDiff && candidate.onsets.length === wordCount) {
        best = candidate
        bestDiff = diff
      }
    }
    if (best) out.lines.push({ time: line.time, onsets: best.onsets })
  }
  return out
}
