import { describe, expect, it } from 'vitest'
import { moodAxes, NEUTRAL_AXES } from './mapping'
import {
  CATALOG,
  isUsable,
  pickForSections,
  presetSetProblems,
  rankForSection,
  scorePreset,
  targetForSection,
  usablePresetNames,
  type CatalogEntry,
  type Feedback,
} from './presetPick'
import type { SemanticSection, SongLook } from './semantics'

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

describe('the look chooses, within the guardrails', () => {
  const catalog = {
    ...Object.fromEntries(
      ['p1', 'p2', 'p3', 'p4', 'p5'].map((name, i) => [name, entry({ quality: 5 - i, slug: name })]),
    ),
    strobing: entry({ flags: ['strobe'] }),
    blank: entry({ flags: ['blank'] }),
    broken: entry({ flags: ['error'] }),
  }
  const look = (presets: Record<string, string>): SongLook => ({
    description: 'made-up look',
    palette: ['#000000', '#111111', '#222222'],
    voices: { main: 'serif', accent: 'slab' },
    presets,
  })
  const sections = [section('a'), section('b'), section('a')]

  it("plays the look's preset even when the scorer ranks it last", () => {
    const picks = pickForSections(sections, noFeedback, catalog, look({ a: 'p5', b: 'p4' }))
    expect(picks.get('a')!.chosen).toBe('p5')
    expect(picks.get('a')!.source).toBe('look')
    expect(picks.get('b')!.chosen).toBe('p4')
    expect(picks.get('a')!.fromFeedback).toBe(false)
  })

  it("puts the look's pick first in the ] [ list, then the scorer's ranking", () => {
    const pick = pickForSections(sections, noFeedback, catalog, look({ a: 'p5' })).get('a')!
    expect(pick.candidates.map((c) => c.name)).toEqual(['p5', 'p1', 'p2', 'p3', 'p4'])
    expect(pick.runnerUp).toBe('p1')
  })

  it('lets the saved choice win over the look', () => {
    const feedback: Feedback = { chosen: { a: 'p2' }, banned: [] }
    const picks = pickForSections(sections, feedback, catalog, look({ a: 'p5', b: 'p4' }))
    expect(picks.get('a')!.chosen).toBe('p2')
    expect(picks.get('a')!.source).toBe('saved')
    expect(picks.get('a')!.fromFeedback).toBe(true)
    // ...and the look's pick stays in the list to cycle back to.
    expect(picks.get('a')!.candidates[0].name).toBe('p5')
    expect(picks.get('b')!.chosen).toBe('p4')
  })

  it('lets a ban win over the look: the scorer picks instead', () => {
    const feedback: Feedback = { chosen: {}, banned: ['p5'] }
    const pick = pickForSections(sections, feedback, catalog, look({ a: 'p5' })).get('a')!
    expect(pick.chosen).toBe('p1')
    expect(pick.source).toBe('scorer')
    expect(pick.candidates.map((c) => c.name)).not.toContain('p5')
  })

  it('never plays a missing, broken, blank or strobing preset from a look', () => {
    for (const bad of ['no such preset', 'broken', 'blank', 'strobing']) {
      const pick = pickForSections(sections, noFeedback, catalog, look({ a: bad })).get('a')!
      expect(pick.chosen).toBe('p1')
      expect(pick.source).toBe('scorer')
    }
  })

  it('falls back to the scorer for a label the look does not cover', () => {
    const picks = pickForSections(sections, noFeedback, catalog, look({ a: 'p5' }))
    expect(picks.get('b')!.source).toBe('scorer')
    expect(picks.get('b')!.chosen).toBe('p1')
  })

  it("does not repeat a neighbour's saved preset through the look", () => {
    const feedback: Feedback = { chosen: { a: 'p4' }, banned: [] }
    const picks = pickForSections(sections, feedback, catalog, look({ b: 'p4' }))
    expect(picks.get('a')!.chosen).toBe('p4')
    expect(picks.get('b')!.chosen).not.toBe('p4')
    expect(picks.get('b')!.source).toBe('scorer')
  })

  it('picks exactly as before when there is no look', () => {
    const before = pickForSections(sections, noFeedback, catalog)
    const explicit = pickForSections(sections, noFeedback, catalog, null)
    expect([...explicit.values()]).toEqual([...before.values()])
    expect(before.get('a')!.source).toBe('scorer')
  })
})

describe('presetSetProblems (the guardrails on a proposed set)', () => {
  const catalog = {
    p1: entry(),
    p2: entry(),
    p3: entry(),
    strobing: entry({ flags: ['strobe'] }),
    blank: entry({ flags: ['blank'] }),
    broken: entry({ flags: ['error'] }),
    slow: entry({ flags: ['slow'] }),
  }
  const labels = ['intro', 'verse', 'chorus', 'verse']
  const problems = (presets: Record<string, string>, feedback: Feedback = noFeedback) =>
    presetSetProblems(presets, labels, feedback, catalog)

  it('accepts a complete set of distinct, usable presets', () => {
    expect(problems({ intro: 'p1', verse: 'p2', chorus: 'p3' })).toEqual([])
    // "slow" costs score in the scorer but is not a reason to refuse.
    expect(problems({ intro: 'p1', verse: 'p2', chorus: 'slow' })).toEqual([])
  })

  it('wants every label covered', () => {
    expect(problems({ intro: 'p1', verse: 'p2' })).toEqual(['no preset chosen for "chorus"'])
  })

  it('refuses names that are not in the catalog', () => {
    expect(problems({ intro: 'p1', verse: 'p2', chorus: 'P3 ' })[0]).toMatch(/"P3 " \(for "chorus"\) is not a preset/)
    expect(problems({ intro: 'p1', verse: 'p2', chorus: 'toString' })[0]).toMatch(/is not a preset/)
  })

  it('refuses broken, blank and hard-strobing presets', () => {
    expect(problems({ intro: 'broken', verse: 'blank', chorus: 'strobing' })).toEqual([
      '"broken" (for "intro") is flagged error and never plays',
      '"blank" (for "verse") is flagged blank and never plays',
      '"strobing" (for "chorus") is flagged strobe and never plays',
    ])
  })

  it('refuses banned presets', () => {
    const feedback: Feedback = { chosen: {}, banned: ['p2'] }
    expect(problems({ intro: 'p1', verse: 'p2', chorus: 'p3' }, feedback)).toEqual([
      '"p2" (for "verse") is banned by the owner',
    ])
  })

  it('refuses one preset for two different labels', () => {
    expect(problems({ intro: 'p1', verse: 'p2', chorus: 'p1' })[0]).toMatch(
      /"p1" is chosen for both "intro" and "chorus"/,
    )
  })

  it('refuses labels the song does not have', () => {
    expect(problems({ intro: 'p1', verse: 'p2', chorus: 'p3', bridge: 'p1' })[0]).toMatch(
      /"bridge" is not a section label/,
    )
  })

  it('lists only presets that may play', () => {
    expect(usablePresetNames({ chosen: {}, banned: ['p3'] }, catalog)).toEqual(['p1', 'p2', 'slow'])
  })
})

describe('the committed library', () => {
  it("keeps every song's look inside the guardrails", async () => {
    const fs = await import('node:fs')
    const { parseSemantics } = await import('./semantics')
    const songsDir = new URL('../public/songs', import.meta.url)
    if (!fs.existsSync(songsDir)) return
    for (const name of fs.readdirSync(songsDir)) {
      const file = new URL(`../public/songs/${name}/semantics.json`, import.meta.url)
      if (!fs.existsSync(file)) continue
      const { semantics } = parseSemantics(JSON.parse(fs.readFileSync(file, 'utf8')))
      if (!semantics?.look) continue
      // Bans change as the owner auditions; a banned look preset falls back
      // to the scorer at runtime. Everything else must hold in the file.
      const labels = semantics.sections.map((s) => s.label)
      expect(presetSetProblems(semantics.look.presets, labels, noFeedback, CATALOG), name).toEqual([])
    }
  })
})
