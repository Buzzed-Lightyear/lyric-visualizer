import { describe, expect, it } from 'vitest'
import catalog from './presetCatalog.json'
import { CATALOG, isUsable } from './presetPick'
import { THRESHOLDS } from './thresholds'

const VOCAB = new Set(
  'fire plasma water ocean rain liquid smoke fog space stars nebula tunnel city grid geometric crystal glass organic flower light-rays glow lightning storm spiral waveform particles ribbons'.split(
    ' ',
  ),
)
const AXES = ['arousal', 'valence', 'tension', 'warmth'] as const

describe('presetCatalog.json', () => {
  it('covers the full installed pack set', () => {
    expect(Object.keys(CATALOG).length).toBeGreaterThan(350)
  })

  it('gives every preset measurements and valid tags', () => {
    for (const [name, entry] of Object.entries(CATALOG)) {
      const where = `"${name}"`
      expect(typeof entry.slug, where).toBe('string')
      for (const key of [
        'brightness',
        'saturation',
        'motion',
        'detail',
        'beatResponse',
        'flicker',
        'readability',
        'costMs',
      ] as const) {
        expect(typeof entry[key], `${where} ${key}`).toBe('number')
        expect(Number.isFinite(entry[key]), `${where} ${key}`).toBe(true)
      }
      expect(Array.isArray(entry.colors), where).toBe(true)
      expect(Array.isArray(entry.flags), where).toBe(true)
      expect(typeof entry.description, where).toBe('string')
      for (const axis of AXES) {
        expect(entry.axes[axis], `${where} ${axis}`).toBeGreaterThanOrEqual(0)
        expect(entry.axes[axis], `${where} ${axis}`).toBeLessThanOrEqual(1)
      }
      expect(entry.quality, where).toBeGreaterThanOrEqual(1)
      expect(entry.quality, where).toBeLessThanOrEqual(5)
      for (const tag of entry.imagery) {
        expect(VOCAB.has(tag), `${where} imagery "${tag}"`).toBe(true)
      }
      // A fully tagged, unflagged preset needs 1-4 imagery tags.
      if (!entry.flags.includes('error') && !entry.flags.includes('untagged')) {
        expect(entry.imagery.length, where).toBeGreaterThanOrEqual(1)
        expect(entry.imagery.length, where).toBeLessThanOrEqual(4)
      }
    }
  })

  it('keeps a healthy pool of usable presets', () => {
    const usable = Object.keys(CATALOG).filter((name) =>
      isUsable(name, { chosen: {}, banned: [] }),
    )
    expect(usable.length).toBeGreaterThan(200)
  })

  it('control presets agree across batches within tolerance', () => {
    const controls = (catalog as { _meta: { controls?: Record<string, { batches: number; mad: Record<string, number> }> } })
      ._meta.controls ?? {}
    const strong = Object.entries(controls).filter(([, c]) => c.batches >= 3)
    expect(strong.length).toBeGreaterThanOrEqual(2)
    for (const [name, control] of strong) {
      for (const axis of AXES) {
        expect(control.mad[axis], `${name} ${axis}`).toBeLessThanOrEqual(
          THRESHOLDS.controlAxisMad,
        )
      }
    }
  })
})
