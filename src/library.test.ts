import { describe, expect, it } from 'vitest'
import {
  buildIndex,
  indexEntry,
  onsetsForLine,
  parseIndex,
  parseMeta,
  parseWordTimes,
  sectionColors,
  slugify,
  songSlug,
  type SongMeta,
} from './library'
import type { Semantics } from './semantics'

const META: SongMeta = {
  title: 'Paper Planets',
  artist: 'The Invented Band',
  album: 'Test Pressing',
  duration: 184.2,
  audio: 'audio.mp3',
  semantics: 'neutral',
}

describe('slugs', () => {
  it('lowercases and hyphenates', () => {
    expect(songSlug('The Invented Band', 'Paper Planets')).toBe('the-invented-band-paper-planets')
  })

  it('strips punctuation and collapses runs', () => {
    expect(songSlug('A.B.C.', 'Song!! (feat. Nobody)')).toBe('a-b-c-song-feat-nobody')
  })

  it('strips diacritics', () => {
    expect(slugify('Fléchette Déjà')).toBe('flechette-deja')
  })

  it('never returns an empty slug', () => {
    expect(songSlug('!!!', '???')).toBe('untitled')
  })
})

describe('meta', () => {
  it('accepts a complete meta', () => {
    expect(parseMeta(META)).toEqual({ meta: META, errors: [] })
  })

  it('rejects missing fields and bad sources', () => {
    const { meta, errors } = parseMeta({ ...META, duration: -1, semantics: 'magic' })
    expect(meta).toBeNull()
    expect(errors.some((e) => e.includes('duration'))).toBe(true)
    expect(errors.some((e) => e.includes('semantics'))).toBe(true)
  })
})

const SEMANTICS: Semantics = {
  sections: [
    {
      start: 0,
      end: 10,
      label: 'one',
      energy: 0.5,
      mood: 'calm',
      palette: ['#000000', '#ff0000'],
      imagery: [],
    },
    {
      start: 10,
      end: 20,
      label: 'two',
      energy: 0.5,
      mood: 'calm',
      palette: ['#000000'],
      imagery: [],
    },
  ],
  lines: [],
}

describe('index', () => {
  it('takes one accent color per section', () => {
    expect(sectionColors(SEMANTICS)).toEqual(['#ff0000', '#000000'])
    expect(sectionColors(null)).toEqual([])
  })

  it('builds sorted entries with a base url', () => {
    const a = indexEntry('zz-song', META, SEMANTICS)
    const b = indexEntry('aa-song', { ...META, artist: 'Aardvark' }, null)
    expect(a.base).toBe('/songs/zz-song/')
    const index = buildIndex([a, b])
    expect(index.songs.map((s) => s.slug)).toEqual(['aa-song', 'zz-song'])
  })

  it('round-trips through parseIndex and skips bad rows', () => {
    const good = indexEntry('ok-song', META, SEMANTICS)
    const parsed = parseIndex({
      version: 1,
      songs: [good, { slug: 'broken' }, 'nonsense', null],
    })
    expect(parsed).toEqual([good])
    expect(parseIndex(null)).toEqual([])
    expect(parseIndex({ version: 1 })).toEqual([])
  })
})

describe('word times', () => {
  const file = { version: 1, lines: [{ time: 5.4, onsets: [5.5, 6.1, 6.8] }] }

  it('parses a valid file and rejects malformed ones', () => {
    expect(parseWordTimes(file)).toEqual(file)
    expect(parseWordTimes({ version: 2, lines: [] })).toBeNull()
    expect(parseWordTimes({ version: 1, lines: [{ time: 'x', onsets: [] }] })).toBeNull()
    expect(parseWordTimes({ version: 1, lines: [{ time: 1, onsets: ['a'] }] })).toBeNull()
  })

  it('matches a line by time and word count', () => {
    const parsed = parseWordTimes(file)
    expect(onsetsForLine(parsed, 5.4, 3)).toEqual([5.5, 6.1, 6.8])
    expect(onsetsForLine(parsed, 5.9, 3)).toEqual([5.5, 6.1, 6.8]) // within tolerance
    expect(onsetsForLine(parsed, 5.4, 4)).toBeNull() // word count disagrees
    expect(onsetsForLine(parsed, 9, 3)).toBeNull() // no entry there
    expect(onsetsForLine(null, 5.4, 3)).toBeNull()
  })
})
