import { describe, expect, it } from 'vitest'
import { moodAxes, NEUTRAL_AXES } from './mapping'
import {
  isUsable,
  pickForSections,
  rankForSection,
  scorePreset,
  targetForSection,
  type CatalogEntry,
  type Feedback,
} from './presetPick'
import type { SemanticSection } from './semantics'

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

const section = (label: string, over: Partial<SemanticSection> = {}): SemanticSection => ({
  start: 0,
  end: 10,
  label,
  energy: 0.5,
  mood: 'calm',
  palette: ['#000000', '#803030', '#a0a0c0'],
  imagery: ['embers'],
  ...over,
})

const noFeedback: Feedback = { chosen: {}, banned: [] }

describe('moodAxes', () => {
  it('maps every song mood into 0..1 axes, neutral for unknowns', () => {
    for (const mood of ['mournful', 'tense', 'menacing', 'weary', 'grieving', 'furious', 'hollow', 'suspended', 'brooding', 'calm']) {
      const axes = moodAxes(mood)
      for (const value of Object.values(axes)) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
      expect(axes).not.toEqual(NEUTRAL_AXES)
    }
    expect(moodAxes('zorblax')).toEqual(NEUTRAL_AXES)
    expect(moodAxes(null)).toEqual(NEUTRAL_AXES)
  })
})

describe('scoring', () => {
  it('is deterministic', () => {
    const catalog = { a: entry() }
    const target = targetForSection(section('verse'))
    expect(scorePreset('a', target, catalog)).toEqual(scorePreset('a', target, catalog))
  })

  it('prefers matching axes, imagery and quality', () => {
    const catalog = {
      close: entry({ axes: moodAxes('furious'), imagery: ['fire'], quality: 5 }),
      far: entry({ axes: moodAxes('calm'), imagery: ['ocean'], quality: 2 }),
    }
    const ranked = rankForSection(
      section('climax', { mood: 'furious', energy: 0.95, imagery: ['embers'] }),
      noFeedback,
      8,
      catalog,
    )
    expect(ranked[0].name).toBe('close')
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  it('never ranks banned, broken, blank or strobing presets', () => {
    const catalog = {
      ok: entry(),
      broken: entry({ flags: ['error'] }),
      blank: entry({ flags: ['blank'] }),
      strobing: entry({ flags: ['strobe'] }),
      banned: entry(),
    }
    const feedback: Feedback = { chosen: {}, banned: ['banned'] }
    const ranked = rankForSection(section('v'), feedback, 8, catalog)
    expect(ranked.map((r) => r.name)).toEqual(['ok'])
    expect(isUsable('broken', feedback, catalog)).toBe(false)
    expect(isUsable('banned', feedback, catalog)).toBe(false)
    expect(isUsable('ok', feedback, catalog)).toBe(true)
  })
})

describe('pickForSections rules', () => {
  const catalog = Object.fromEntries(
    ['p1', 'p2', 'p3', 'p4'].map((name, i) => [
      name,
      entry({ quality: 5 - i, slug: name }), // p1 scores highest
    ]),
  )

  it('gives sections with the same label the same preset', () => {
    const sections = [section('verse'), section('chorus'), section('verse')]
    const picks = pickForSections(sections, noFeedback, catalog)
    expect(picks.get('verse')!.chosen).toBeTruthy()
    expect(picks.size).toBe(2) // one pick per label
  })

  it('never gives neighbouring sections the same preset', () => {
    const sections = [section('a'), section('b'), section('c')]
    const picks = pickForSections(sections, noFeedback, catalog)
    expect(picks.get('a')!.chosen).not.toBe(picks.get('b')!.chosen)
    expect(picks.get('b')!.chosen).not.toBe(picks.get('c')!.chosen)
  })

  it('is deterministic for the same inputs', () => {
    const sections = [section('a'), section('b'), section('a'), section('c')]
    const one = pickForSections(sections, noFeedback, catalog)
    const two = pickForSections(sections, noFeedback, catalog)
    expect([...one.entries()].map(([k, v]) => [k, v.chosen])).toEqual(
      [...two.entries()].map(([k, v]) => [k, v.chosen]),
    )
  })

  it('honours a saved choice and drops it when banned', () => {
    const sections = [section('a'), section('b')]
    const saved = pickForSections(sections, { chosen: { a: 'p3' }, banned: [] }, catalog)
    expect(saved.get('a')!.chosen).toBe('p3')
    expect(saved.get('a')!.fromFeedback).toBe(true)
    const banned = pickForSections(sections, { chosen: { a: 'p3' }, banned: ['p3'] }, catalog)
    expect(banned.get('a')!.chosen).not.toBe('p3')
    expect(banned.get('a')!.fromFeedback).toBe(false)
  })
})
