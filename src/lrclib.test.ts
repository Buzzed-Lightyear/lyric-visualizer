import { describe, expect, it } from 'vitest'
import { parseLyricsfile, parseTrack, pickSearchResult, wordTimesForLrc } from './lrclib'

// Made-up track objects in the LRCLIB response shape.
const track = (over: Record<string, unknown> = {}) => ({
  id: 7,
  trackName: 'Paper Planets',
  artistName: 'The Invented Band',
  albumName: 'Test Pressing',
  duration: 184,
  instrumental: false,
  plainLyrics: 'made up words\nmore made up words',
  syncedLyrics: '[00:05.40] made up words\n[00:09.00] more made up words',
  ...over,
})

describe('parseTrack', () => {
  it('reads a full /api/get response', () => {
    const parsed = parseTrack(track({ hasWordSync: true, lyricsfile: 'version: 1' }))
    expect(parsed?.syncedLyrics).toContain('[00:05.40]')
    expect(parsed?.hasWordSync).toBe(true)
    expect(parsed?.lyricsfile).toBe('version: 1')
  })

  it('tolerates missing optional fields and rejects garbage', () => {
    const parsed = parseTrack(track({ syncedLyrics: null, lyricsfile: undefined }))
    expect(parsed?.syncedLyrics).toBeNull()
    expect(parsed?.lyricsfile).toBeNull()
    expect(parsed?.hasWordSync).toBe(false)
    expect(parseTrack(null)).toBeNull()
    expect(parseTrack({ id: 'x' })).toBeNull()
  })
})

describe('pickSearchResult', () => {
  it('takes the first synced result within 2s of our duration', () => {
    const results = [
      track({ id: 1, duration: 150 }), // too far off
      track({ id: 2, duration: 183, syncedLyrics: null }), // no synced lyrics
      track({ id: 3, duration: 183 }),
      track({ id: 4, duration: 184 }),
    ]
    expect(pickSearchResult(results, 184)?.id).toBe(3)
  })

  it('returns null when nothing matches', () => {
    expect(pickSearchResult([track({ duration: 100 })], 184)).toBeNull()
    expect(pickSearchResult('not an array', 184)).toBeNull()
    expect(pickSearchResult([], 184)).toBeNull()
  })
})

// A made-up lyricsfile in the shape LRCLIB serves: YAML with per-word
// start_ms. The text values are deliberately awkward (quotes, commas).
const LYRICSFILE = `version: '1.0'
metadata:
  title: Paper Planets
  duration_ms: 20000
lines:
- text: fold the paper, let it fly
  start_ms: 5400
  end_ms: 8000
  words:
  - text: 'fold '
    start_ms: 5500
  - text: 'the '
    start_ms: 5900
  - text: 'paper, '
    start_ms: 6200
  - text: 'let '
    start_ms: 6900
  - text: 'it '
    start_ms: 7100
  - text: fly
    start_ms: 7300
- text: it''s gone
  start_ms: 9000
  end_ms: 11000
  words:
  - text: 'it''s '
    start_ms: 9100
  - text: gone
    start_ms: 9600
`

describe('parseLyricsfile', () => {
  it('extracts per-word onsets in seconds', () => {
    const parsed = parseLyricsfile(LYRICSFILE)
    expect(parsed).toHaveLength(2)
    expect(parsed![0].time).toBeCloseTo(5.4)
    expect(parsed![0].onsets).toEqual([5.5, 5.9, 6.2, 6.9, 7.1, 7.3])
    expect(parsed![1].onsets).toEqual([9.1, 9.6])
  })

  it('returns null for documents without word timing', () => {
    expect(parseLyricsfile('')).toBeNull()
    expect(parseLyricsfile('version: 1\nmetadata:\n  title: x\n')).toBeNull()
  })

  it('drops a line whose words are missing times, keeps the rest', () => {
    const broken = LYRICSFILE.replace('    start_ms: 9600\n', '')
    const parsed = parseLyricsfile(broken)
    expect(parsed).toHaveLength(1)
    expect(parsed![0].time).toBeCloseTo(5.4)
  })
})

describe('wordTimesForLrc', () => {
  const lrcLines = [
    { time: 5.4, text: 'fold the paper, let it fly' },
    { time: 9.05, text: "it's gone" }, // slightly off: still within 1s
    { time: 15, text: 'a line lrclib never timed' },
    { time: 18, text: '' }, // instrumental marker
  ]

  it('aligns by time and word count, skipping the rest', () => {
    const parsed = parseLyricsfile(LYRICSFILE)!
    const words = wordTimesForLrc(lrcLines, parsed)
    expect(words.version).toBe(1)
    expect(words.lines).toEqual([
      { time: 5.4, onsets: [5.5, 5.9, 6.2, 6.9, 7.1, 7.3] },
      { time: 9.05, onsets: [9.1, 9.6] },
    ])
  })

  it('refuses a line whose word count disagrees', () => {
    const parsed = parseLyricsfile(LYRICSFILE)!
    const words = wordTimesForLrc([{ time: 5.4, text: 'only three words' }], parsed)
    expect(words.lines).toEqual([])
  })
})
