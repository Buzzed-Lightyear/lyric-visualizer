import { describe, expect, it } from 'vitest'
import { chooseMotif, ENTRANCE_LADDER, entranceForLine, exitForLine, layoutForLine, NEUTRAL_PARAMS, paramsForSection, textParamsForLine } from './mapping'
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

describe('textParamsForLine (mood -> hold & voice, deterministic parts)', () => {
  it('maps moods to hold and voice', () => {
    const menacing = textParamsForLine(section({ mood: 'menacing' }), 0.5, 10, null)
    expect(menacing.hold).toBe('jolt')
    expect(menacing.voice).toBe('condensed')
    const mournful = textParamsForLine(section({ mood: 'mournful' }), 0.5, 10, null)
    expect(mournful.hold).toBe('bob')
    expect(mournful.voice).toBe('whisper')
  })

  it('falls back to the default for unknown moods and no section', () => {
    expect(textParamsForLine(section({ mood: 'zorblax' }), 0.5, 10, null).hold).toBe('bob')
    expect(textParamsForLine(null, 0.5, 10, null).voice).toBe('air')
  })

  it('switches to the accent voice at high emphasis', () => {
    const base = textParamsForLine(section({ mood: 'furious' }), 0.5, 10, null)
    const hot = textParamsForLine(section({ mood: 'furious' }), 0.9, 10, null)
    expect(base.voice).toBe('block')
    expect(hot.voice).toBe('marker')
  })

  it('is deterministic: the same line always gets the same parts', () => {
    const a = textParamsForLine(section(), 0.7, 42.5, 39.1)
    const b = textParamsForLine(section(), 0.7, 42.5, 39.1)
    expect(a).toEqual(b)
  })
})

describe('entranceForLine (energy ladder)', () => {
  it('is calm at low energy and violent at high', () => {
    const calmSet = new Set<string>()
    const hotSet = new Set<string>()
    for (let t = 0; t < 40; t += 1.7) {
      calmSet.add(entranceForLine(0, t, null))
      hotSet.add(entranceForLine(1, t, null))
    }
    const calmSide = ENTRANCE_LADDER.slice(0, 3)
    const hotSide = ENTRANCE_LADDER.slice(-3)
    for (const pick of calmSet) expect(calmSide).toContain(pick)
    for (const pick of hotSet) expect(hotSide).toContain(pick)
  })

  it('avoids repeating the previous line\'s entrance', () => {
    for (let t = 1; t < 60; t += 2.3) {
      const prev = t - 2.3
      const prevPick = entranceForLine(0.5, prev, null)
      // Re-derive what this line would pick given the previous line.
      const pick = entranceForLine(0.5, t, prev)
      if (entranceForLine(0.5, t, null) === prevPick) {
        expect(pick).not.toBe(prevPick)
      }
    }
  })
})

describe('exitForLine and layoutForLine (emphasis brackets)', () => {
  it('uses shatter or knock at the top, sink or blow at the bottom', () => {
    expect(['shatter', 'knock']).toContain(exitForLine(0.9, 'bob', 10))
    expect(['sink', 'blow']).toContain(exitForLine(0.2, 'bob', 10))
    expect(exitForLine(0.5, 'bob', 10)).toBe('liftOff') // the hold's default
    expect(exitForLine(0.5, 'rest', 10)).toBe('collapse')
  })

  it('maps emphasis to layout brackets', () => {
    expect(layoutForLine(0.9)).toBe('focus')
    expect(layoutForLine(0.7)).toBe('lockup')
    expect(layoutForLine(0.5)).toBe('centered')
  })
})
