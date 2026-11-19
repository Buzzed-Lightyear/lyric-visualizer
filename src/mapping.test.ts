import { describe, expect, it } from 'vitest'
import {
  chooseMotif,
  ENTRANCE_LADDER,
  layoutForLine,
  NEUTRAL_PARAMS,
  paramsForSection,
  sectionGrammar,
  textParamsForLine,
} from './mapping'
import type { SemanticSection } from './semantics'

const section = (over: Partial<SemanticSection> = {}): SemanticSection => ({
  start: 0,
  end: 10,
  label: 'test',
  energy: 0.5,
  mood: 'calm',
  palette: ['#102030', '#ff8040', '#a0b0c0', '#ffffff'],
  imagery: ['embers'],
  ...over,
})

describe('chooseMotif', () => {
  it('picks the first imagery tag with a mapping', () => {
    expect(chooseMotif(['flagless-nonsense', 'rain', 'embers'])).toEqual({
      motif: 'rain',
      tag: 'rain',
    })
  })

  it('falls through to haze, never drift', () => {
    expect(chooseMotif(['unknown', 'tags']).motif).toBe('haze')
    expect(chooseMotif([]).motif).toBe('haze')
  })
})

describe('paramsForSection', () => {
  it('returns neutral (the step 2 look) for no section', () => {
    expect(paramsForSection(null, 0.5)).toBe(NEUTRAL_PARAMS)
    expect(NEUTRAL_PARAMS.motif).toBe('drift')
    expect(NEUTRAL_PARAMS.accent).toBe(1)
  })

  it('is deterministic: same inputs, same params', () => {
    const s = section()
    expect(paramsForSection(s, 0.7)).toEqual(paramsForSection(s, 0.7))
  })

  it('maps the palette in order: background, glow, particles, ring', () => {
    const p = paramsForSection(section(), 0.5)
    expect(p.background).toEqual([16, 32, 48])
    expect(p.glowColor).toEqual([255, 128, 64])
    expect(p.particleColor).toEqual([160, 176, 192])
    expect(p.ringColor).toEqual([255, 255, 255])
  })

  it('falls back to the glow color for a 3-color palette ring', () => {
    const p = paramsForSection(section({ palette: ['#102030', '#ff8040', '#a0b0c0'] }), 0.5)
    expect(p.ringColor).toEqual(p.glowColor)
  })

  it('scales intensity with energy, monotonically', () => {
    const low = paramsForSection(section({ energy: 0.1 }), 0.5)
    const high = paramsForSection(section({ energy: 0.9 }), 0.5)
    expect(high.particleCount).toBeGreaterThan(low.particleCount)
    expect(high.speed).toBeGreaterThan(low.speed)
    expect(high.glowScale).toBeGreaterThan(low.glowScale)
  })

  it('maps emphasis to accent with 0.5 neutral', () => {
    expect(paramsForSection(section(), 0.5).accent).toBeCloseTo(1)
    expect(paramsForSection(section(), 0.95).accent).toBeGreaterThan(1.4)
    expect(paramsForSection(section(), 0.2).accent).toBeLessThan(0.7)
  })

  it('keys repeats of a section identically, distinct sections apart', () => {
    const a = paramsForSection(section({ label: 'chorus', start: 100 }), 0.5)
    const b = paramsForSection(section({ label: 'chorus', start: 100 }), 0.9)
    const c = paramsForSection(section({ label: 'chorus', start: 200 }), 0.5)
    expect(a.key).toBe(b.key)
    expect(a.key).not.toBe(c.key)
  })

  it('gives unknown moods neutral motion', () => {
    const p = paramsForSection(section({ mood: 'zorblax' }), 0.5)
    expect(p.jitter).toBe(1)
    expect(p.lift).toBe(0)
  })
})

describe('sectionGrammar (one base motion per section)', () => {
  it('derives everything from mood and energy, deterministically', () => {
    const s = section({ mood: 'menacing', energy: 0.8 })
    expect(sectionGrammar(s)).toEqual(sectionGrammar(s))
    const g = sectionGrammar(s)
    expect(g.hold).toBe('jolt')
    expect(g.voice).toBe('condensed')
    expect(g.anchor).toBe('low')
    expect(g.exit).toBe('tumble')
  })

  it('picks the entrance from the energy ladder, calm to violent', () => {
    expect(sectionGrammar(section({ energy: 0 })).entrance).toBe(ENTRANCE_LADDER[0])
    expect(sectionGrammar(section({ energy: 1 })).entrance).toBe(
      ENTRANCE_LADDER[ENTRANCE_LADDER.length - 1],
    )
  })

  it('maps moods to anchors', () => {
    expect(sectionGrammar(section({ mood: 'tense' })).anchor).toBe('upperLeft')
    expect(sectionGrammar(section({ mood: 'hollow' })).anchor).toBe('upperLeft')
    expect(sectionGrammar(section({ mood: 'weary' })).anchor).toBe('low')
    expect(sectionGrammar(section({ mood: 'mournful' })).anchor).toBe('center')
    expect(sectionGrammar(section({ mood: 'zorblax' })).anchor).toBe('center')
  })

  it('falls back to the default grammar without a section', () => {
    const g = sectionGrammar(null)
    expect(g.voice).toBe('air')
    expect(g.hold).toBe('bob')
    expect(g.anchor).toBe('center')
  })
})

describe('textParamsForLine (section grammar + line meaning)', () => {
  it('gives every line of a section the same base motion', () => {
    const s = section({ mood: 'furious', energy: 0.9 })
    const a = textParamsForLine(s, 0.5)
    const b = textParamsForLine(s, 0.6)
    expect(a.entrance).toBe(b.entrance)
    expect(a.hold).toBe(b.hold)
    expect(a.exit).toBe(b.exit)
    expect(a.voice).toBe(b.voice)
    expect(a.anchor).toBe(b.anchor)
  })

  it('switches to the accent voice at high emphasis', () => {
    const base = textParamsForLine(section({ mood: 'furious' }), 0.5)
    const hot = textParamsForLine(section({ mood: 'furious' }), 0.9)
    expect(base.voice).toBe('block')
    expect(hot.voice).toBe('marker')
  })

  it('honors a refrain grammar override and carries focus and gestures', () => {
    const s = section({ mood: 'calm', energy: 0.2 })
    const sourceGrammar = sectionGrammar(section({ mood: 'menacing', energy: 0.8 }))
    const p = textParamsForLine(s, 0.5, {
      grammar: sourceGrammar,
      focus: [1, 3],
      gestures: [{ index: 1, gesture: 'fall', dir: null, source: 'direction' }],
    })
    expect(p.entrance).toBe(sourceGrammar.entrance)
    expect(p.hold).toBe('jolt')
    expect(p.focus).toEqual([1, 3])
    expect(p.gestures[0].gesture).toBe('fall')
  })

  it('falls back to the default for unknown moods and no section', () => {
    expect(textParamsForLine(section({ mood: 'zorblax' }), 0.5).hold).toBe('bob')
    expect(textParamsForLine(null, 0.5).voice).toBe('air')
  })

  it('maps emphasis to layout brackets', () => {
    expect(layoutForLine(0.9)).toBe('focus')
    expect(layoutForLine(0.7)).toBe('lockup')
    expect(layoutForLine(0.5)).toBe('centered')
  })
})
