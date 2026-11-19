import { describe, expect, it } from 'vitest'
import { chooseMotif, NEUTRAL_PARAMS, paramsForSection } from './mapping'
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
