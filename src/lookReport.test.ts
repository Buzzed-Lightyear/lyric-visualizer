import { describe, expect, it } from 'vitest'
import {
  formatComparison,
  formatLibrary,
  libraryReport,
  type ReportSong,
} from './lookReport'
import type { CatalogEntry } from './presetPick'
import type { SemanticSection, SongLook } from './semantics'

// A made-up catalog and a made-up library of two songs.

const entry = (over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  slug: 'x',
  colors: [[120, 40, 40]],
  brightness: 0.3,
  saturation: 0.5,
  motion: 0.05,
  detail: 0.05,
  beatResponse: 0.4,
  flicker: 0.05,
  readability: 0.6,
  costMs: 2,
  flags: [],
  description: 'a fake preset',
  axes: { arousal: 0.5, valence: 0.5, tension: 0.5, warmth: 0.5 },
  imagery: ['fire'],
  quality: 3,
  ...over,
})

// p1 and p2 outscore everything for every section, so the scorer alone
// dresses both songs in the same two presets.
const CATALOG: Record<string, CatalogEntry> = {
  p1: entry({ quality: 5 }),
  p2: entry({ quality: 4 }),
  amber: entry({ quality: 1 }),
  blue: entry({ quality: 1 }),
  red: entry({ quality: 1 }),
  grey: entry({ quality: 1 }),
  strobing: entry({ quality: 5, flags: ['strobe'] }),
  banned: entry({ quality: 5 }),
}

const section = (label: string, start: number, over: Partial<SemanticSection> = {}): SemanticSection => ({
  start,
  end: start + 10,
  label,
  energy: 0.5,
  mood: 'calm',
  palette: ['#000000', '#803030', '#a0a0c0'],
  imagery: ['embers'],
  ...over,
})

const look = (presets: Record<string, string>, over: Partial<SongLook> = {}): SongLook => ({
  description: 'made-up look',
  palette: ['#101010', '#e0a040', '#f4e2b8'],
  voices: { main: 'serif', accent: 'slab' },
  presets,
  presetsFrom: 'model',
  ...over,
})

const BANNED = ['banned']

const songs = (): ReportSong[] => [
  {
    slug: 'paper-planets',
    title: 'Paper Planets',
    artist: 'The Invented Band',
    sections: [
      section('verse', 0, { mood: 'calm', imagery: ['stars', 'haze'] }),
      section('chorus', 10, { mood: 'furious', imagery: ['embers'] }),
      section('verse', 20, { mood: 'calm', imagery: ['stars', 'haze'] }),
    ],
    look: look({ verse: 'amber', chorus: 'red' }),
    feedback: { chosen: {}, banned: BANNED },
  },
  {
    slug: 'static-garden',
    title: 'Static Garden',
    artist: 'Fixture Ensemble',
    sections: [
      section('verse', 0, { mood: 'Calm', imagery: ['Stars'] }),
      section('bridge', 10, { mood: 'washed out, kind', imagery: ['television snow'], axes: { arousal: 0.3, valence: 0.6, tension: 0.2, warmth: 0.4 }, voice: 'accent' }),
    ],
    look: look({ verse: 'blue', bridge: 'grey' }, { partial: true, voices: { main: 'air', accent: 'marker' } }),
    feedback: { chosen: { bridge: 'p2' }, banned: BANNED },
  },
]

describe('libraryReport', () => {
  it('reads the library as the scorer alone would dress it', () => {
    const before = libraryReport(songs(), false, CATALOG)
    expect(before.picks).toBe(4)
    expect(before.distinctPresets).toBe(2)
    expect(before.usablePresets).toBe(6) // not the strobing one, not the banned one
    expect(before.topPresets.slice(0, 2)).toEqual([
      { name: 'p1', count: 2 },
      { name: 'p2', count: 2 },
    ])
    expect(before.pairs).toEqual([{ a: 'paper-planets', b: 'static-garden', shared: ['p1', 'p2'] }])
    expect(before.pairsSharing).toBe(1)
    const [first] = before.songs
    expect(first.look).toBe('none')
    expect(first.presetsFrom).toBe('scorer')
    expect(first.presets).toEqual({ verse: 'p1', chorus: 'p2' })
    // Voices follow the mood words: calm -> air, furious -> block.
    expect(first.voicesFrom).toBe('mood anchors')
    expect(first.voices.main).toEqual(['air', 'block'])
    expect(first.voices.accent).toEqual(['condensed', 'marker'])
  })

  it('reads the library with its looks', () => {
    const after = libraryReport(songs(), true, CATALOG)
    expect(after.distinctPresets).toBe(4)
    expect(after.pairsSharing).toBe(0)
    expect(after.pairs[0].shared).toEqual([])
    const [first, second] = after.songs
    expect(first.look).toBe('full')
    expect(first.presetsFrom).toBe('model')
    expect(first.presets).toEqual({ verse: 'amber', chorus: 'red' })
    expect(first.distinctPresets).toBe(2)
    expect(first.voices).toEqual({ main: ['serif'], accent: ['slab'] })
    expect(first.palette).toEqual(['#101010', '#e0a040', '#f4e2b8'])
    expect(second.look).toBe('partial')
    // A section set in the accent voice shows up in the song's voices.
    expect(second.voices).toEqual({ main: ['air', 'marker'], accent: ['marker'] })
  })

  it('reports saved choices as overrides, without counting them as the look', () => {
    const after = libraryReport(songs(), true, CATALOG)
    expect(after.songs[1].presets.bridge).toBe('grey')
    expect(after.songs[1].overrides).toEqual({ bridge: 'p2' })
    expect(after.songs[0].overrides).toEqual({})
  })

  it('counts mood and imagery terms once, whatever their case', () => {
    const after = libraryReport(songs(), true, CATALOG)
    expect(after.moodTerms).toEqual(['calm', 'furious', 'washed out, kind'])
    expect(after.imageryTerms).toEqual(['embers', 'haze', 'stars', 'television snow'])
    expect(after.songs[1].moods).toEqual(['calm', 'washed out, kind'])
  })

  it('says so when a look had to fall back to the scorer', () => {
    const library = songs()
    library[0].look = look({ verse: 'strobing', chorus: 'no such preset' })
    const after = libraryReport(library, true, CATALOG)
    expect(after.songs[0].presets).toEqual({ verse: 'p1', chorus: 'p2' })
    expect(after.songs[0].presetsFrom).toBe('scorer')
    library[0].look = look({ verse: 'amber', chorus: 'red' }, { presetsFrom: 'scorer' })
    expect(libraryReport(library, true, CATALOG).songs[0].presetsFrom).toBe('scorer')
  })

  it('reports the measured readability of the picks', () => {
    const catalog = {
      ...CATALOG,
      amber: entry({ quality: 1, readability: 0.2 }),
      red: entry({ quality: 1, readability: 0.9 }),
    }
    // Picks with looks: amber 0.2, red 0.9, blue 0.6, grey 0.6.
    expect(libraryReport(songs(), true, catalog).readability).toEqual({ median: 0.6, lowest: 0.2 })
    expect(libraryReport(songs(), false, catalog).readability).toEqual({ median: 0.6, lowest: 0.6 })
  })

  it('carries the record of the image review', () => {
    const library = songs()
    library[0].look = look({ verse: 'amber', chorus: 'red' }, { review: { ran: true, swapped: ['chorus'] } })
    library[1].look = look({ verse: 'blue', bridge: 'grey' }, { review: { ran: false, swapped: [] } })
    const after = libraryReport(library, true, CATALOG)
    expect(after.songs[0].review).toEqual({ ran: true, swapped: ['chorus'] })
    const text = formatLibrary('AFTER', after).join('\n')
    expect(text).toContain('review:  the strips were looked at; 1 swapped (chorus)')
    expect(text).toContain('review:  did not run (chosen from text only)')
    expect(libraryReport(songs(), true, CATALOG).songs[0].review).toBeNull()
  })

  it('is deterministic and leaves the library untouched', () => {
    const library = songs()
    const snapshot = JSON.stringify(library)
    expect(libraryReport(library, true, CATALOG)).toEqual(libraryReport(library, true, CATALOG))
    expect(JSON.stringify(library)).toBe(snapshot)
  })
})

describe('the printed report', () => {
  const before = libraryReport(songs(), false, CATALOG)
  const after = libraryReport(songs(), true, CATALOG)

  it('prints before and after side by side', () => {
    const text = formatComparison(before, after).join('\n')
    expect(text).toMatch(/distinct presets\s+2 of 4 picks\s+4 of 4 picks/)
    expect(text).toMatch(/three most used presets take\s+4 of 4\s+3 of 4/)
    expect(text).toMatch(/song pairs sharing a preset\s+1 of 1\s+0 of 1/)
    expect(text).toMatch(/distinct mood terms\s+3\s+3/)
    expect(text).toMatch(/distinct imagery terms\s+4\s+4/)
    expect(text).toMatch(/type voices used within one song\s+2 to 4\s+2/)
    expect(text).toMatch(/text readability of the picks, median\s+0\.60\s+0\.60/)
  })

  it('prints each song: presets, overrides, voices, palette, terms and overlaps', () => {
    const text = formatLibrary('AFTER', after).join('\n')
    expect(text).toContain('4 section picks use 4 of 6 usable presets')
    expect(text).toContain('0 of 1 song pairs share at least one preset')
    expect(text).toContain('presets: 2 distinct for 2 labels (chosen by the model; look is partial)')
    expect(text).toContain('your kept choices play instead on 1 of 2 labels')
    expect(text).toContain('voices:  main serif / accent slab (from look)')
    expect(text).toContain('palette: #101010 #e0a040 #f4e2b8')
    expect(text).toContain('(every preset is used once)')
    const beforeText = formatLibrary('BEFORE', before).join('\n')
    expect(beforeText).toMatch(/paper-planets\s+static-garden\s+2\s+\(p1 \| p2\)/)
    expect(beforeText).toContain(' 2x  p1')
  })
})
