import { describe, expect, it } from 'vitest'
import {
  accentPasses,
  backingNeeded,
  BLACK_STATS,
  choosePolarity,
  contrastRatio,
  easeBacking,
  pickAccent,
  polarityNeeds,
  regionStats,
  relativeLuminance,
  textTones,
  throughBacking,
  type Backdrop,
  type RegionStats,
} from './legibility'
import type { Rgb } from './mapping'
import { LEGIBLE } from './tuning'

const TARGET = 4.5
const FLOOR = 3
const TONES = { light: relativeLuminance([232, 238, 248]), dark: relativeLuminance([8, 10, 18]) }

/** A flat background of one luminance. */
const flat = (lum: number): RegionStats => ({ mean: lum, lo: lum, hi: lum, busy: 0 })
/** A background that swings between two luminances (stripes, noise). */
const busy = (lo: number, hi: number): RegionStats => ({ mean: (lo + hi) / 2, lo, hi, busy: hi - lo })

/** A backdrop painted by a function of (x, y). */
function backdrop(width: number, height: number, paint: (x: number, y: number) => Rgb): Backdrop {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y)
      data.set([r, g, b, 255], (y * width + x) * 4)
    }
  }
  return { width, height, data, version: 1 }
}

const WHOLE = { x0: 0, y0: 0, x1: 1, y1: 1 }

describe('luminance and contrast', () => {
  it('matches the WCAG reference points', () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0)
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5)
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 5)
    expect(contrastRatio(0.2, 0.2)).toBe(1)
    // #767676 on white is the textbook 4.54:1.
    expect(contrastRatio(relativeLuminance([118, 118, 118]), 1)).toBeCloseTo(4.54, 1)
  })
})

describe('reading the background', () => {
  it('treats a missing backdrop as black', () => {
    expect(regionStats(null, WHOLE)).toEqual(BLACK_STATS)
  })

  it('reads only the region under the line', () => {
    // Left half black, right half white.
    const split = backdrop(20, 10, (x) => (x < 10 ? [0, 0, 0] : [255, 255, 255]))
    expect(regionStats(split, { x0: 0, y0: 0, x1: 0.5, y1: 1 }).hi).toBe(0)
    expect(regionStats(split, { x0: 0.5, y0: 0, x1: 1, y1: 1 }).lo).toBeCloseTo(1, 5)
    const both = regionStats(split, WHOLE)
    expect(both.lo).toBe(0)
    expect(both.hi).toBeCloseTo(1, 5)
    expect(both.busy).toBeCloseTo(1, 5)
    expect(both.mean).toBeCloseTo(0.5, 5)
  })

  it('reports busyness: stripes are busy, a flat field is not', () => {
    const stripes = backdrop(40, 10, (x) => (x % 4 < 2 ? [10, 10, 10] : [245, 245, 245]))
    const field = backdrop(40, 10, () => [90, 90, 90])
    expect(regionStats(stripes, WHOLE).busy).toBeGreaterThan(0.8)
    expect(regionStats(field, WHOLE).busy).toBe(0)
  })

  it('ignores a few stray pixels: the ends are percentiles, not extremes', () => {
    const speck = backdrop(50, 20, (x, y) => (x === 3 && y === 3 ? [255, 255, 255] : [20, 20, 20]))
    expect(regionStats(speck, WHOLE).hi).toBeCloseTo(relativeLuminance([20, 20, 20]), 5)
  })

  it('reads through the wash the text layer paints over the background', () => {
    const white = backdrop(8, 8, () => [255, 255, 255])
    const washed = regionStats(white, WHOLE, [{ color: [0, 0, 0], alpha: 0.5 }])
    expect(washed.hi).toBeCloseTo(relativeLuminance([128, 128, 128]), 2)
    // With no backdrop the wash alone is what is behind the text.
    expect(regionStats(null, WHOLE, [{ color: [255, 255, 255], alpha: 1 }]).mean).toBeCloseTo(1, 5)
  })

  it('clamps a region that pokes outside the view', () => {
    const grey = backdrop(8, 8, () => [128, 128, 128])
    const stats = regionStats(grey, { x0: -0.5, y0: 0.9, x1: 1.5, y1: 1.4 })
    expect(stats.mean).toBeCloseTo(relativeLuminance([128, 128, 128]), 5)
  })
})

describe('backing strength: only as strong as the background requires', () => {
  it('is nothing over a calm dark scene under light text', () => {
    expect(backingNeeded('light', flat(0.01), TONES.light, TONES.dark, TARGET)).toBe(0)
    expect(backingNeeded('light', busy(0, 0.1), TONES.light, TONES.dark, TARGET)).toBe(0)
  })

  it('is nothing over a calm bright scene under dark text', () => {
    expect(backingNeeded('dark', flat(0.8), TONES.dark, TONES.light, TARGET)).toBe(0)
  })

  it('grows with how bright the background gets under light text', () => {
    const at = (hi: number) => backingNeeded('light', busy(0, hi), TONES.light, TONES.dark, TARGET)
    expect(at(0.2)).toBeGreaterThan(0)
    expect(at(0.5)).toBeGreaterThan(at(0.2))
    expect(at(1)).toBeGreaterThan(at(0.5))
    expect(at(1)).toBeLessThanOrEqual(1)
  })

  it('grows with how dark the background gets under dark text', () => {
    const at = (lo: number) => backingNeeded('dark', busy(lo, 1), TONES.dark, TONES.light, TARGET)
    expect(at(0.15)).toBeGreaterThan(0)
    expect(at(0.02)).toBeGreaterThan(at(0.15))
  })

  it('delivers the target contrast when applied', () => {
    // Whatever the background, text against (background seen through the
    // backing) reaches the target, for both polarities.
    for (const lum of [0.05, 0.2, 0.4, 0.7, 1]) {
      const light = backingNeeded('light', flat(lum), TONES.light, TONES.dark, TARGET)
      const seen = throughBacking(lum, TONES.dark, light)
      expect(contrastRatio(TONES.light, seen)).toBeGreaterThanOrEqual(TARGET - 1e-6)
    }
    for (const lum of [0, 0.02, 0.1, 0.3, 0.6]) {
      const dark = backingNeeded('dark', flat(lum), TONES.dark, TONES.light, TARGET)
      const seen = throughBacking(lum, TONES.light, dark)
      expect(contrastRatio(TONES.dark, seen)).toBeGreaterThanOrEqual(TARGET - 1e-6)
    }
  })

  it('is no stronger than needed: one step less misses the target', () => {
    const need = backingNeeded('light', flat(0.6), TONES.light, TONES.dark, TARGET)
    expect(need).toBeGreaterThan(0.1)
    const weaker = throughBacking(0.6, TONES.dark, need - 0.05)
    expect(contrastRatio(TONES.light, weaker)).toBeLessThan(TARGET)
  })

  it('goes to full when even a solid backing cannot reach the target', () => {
    // Mid-grey "light" text can never reach 4.5:1 on anything.
    expect(backingNeeded('light', flat(0.5), 0.1, 0, TARGET)).toBe(1)
  })
})

describe('polarity decision', () => {
  it('sets light text on dark scenes and dark text on bright ones', () => {
    expect(choosePolarity(null, flat(0.02), TONES, TARGET, LEGIBLE.hysteresis)).toBe('light')
    expect(choosePolarity(null, flat(0.7), TONES, TARGET, LEGIBLE.hysteresis)).toBe('dark')
  })

  it('picks the tone that needs less backing', () => {
    for (const lum of [0, 0.05, 0.1, 0.2, 0.35, 0.6, 1]) {
      const needs = polarityNeeds(flat(lum), TONES, TARGET)
      const chosen = choosePolarity(null, flat(lum), TONES, TARGET, LEGIBLE.hysteresis)
      expect(needs[chosen]).toBeLessThanOrEqual(needs[chosen === 'light' ? 'dark' : 'light'])
    }
  })

  it('holds the previous choice across a background that hovers near the middle', () => {
    // Find the luminance where both tones need the same backing...
    let lo = 0.05
    let hi = 0.5
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      const needs = polarityNeeds(flat(mid), TONES, TARGET)
      if (needs.light < needs.dark) lo = mid
      else hi = mid
    }
    const cross = (lo + hi) / 2
    // ...and enter a run of lines over backgrounds wobbling around it.
    const wobble = [-0.01, 0.01, -0.008, 0.012, -0.01, 0.01, -0.012, 0.008].map((d) => cross + d)
    for (const start of ['light', 'dark'] as const) {
      let polarity: 'light' | 'dark' = start
      let flips = 0
      for (const lum of wobble) {
        const next = choosePolarity(polarity, flat(lum), TONES, TARGET, LEGIBLE.hysteresis)
        if (next !== polarity) flips++
        polarity = next
      }
      expect(flips).toBe(0)
    }
    // Without the memory of the previous line the same run flips every time.
    let polarity: 'light' | 'dark' | null = null
    let flips = 0
    for (const lum of wobble) {
      const next = choosePolarity(null, flat(lum), TONES, TARGET, LEGIBLE.hysteresis)
      if (polarity !== null && next !== polarity) flips++
      polarity = next
    }
    expect(flips).toBe(wobble.length - 1)
  })

  it('goes by the area, not by a few bright spots', () => {
    // Mostly black with white shapes on a tenth of it: light text, although
    // dark text would need the same backing at its worst point.
    const spotted = regionStats(
      backdrop(40, 20, (x) => (x % 10 === 0 ? [255, 255, 255] : [4, 4, 6])),
      WHOLE,
    )
    expect(spotted.hi).toBeGreaterThan(0.9)
    expect(choosePolarity(null, spotted, TONES, TARGET, LEGIBLE.hysteresis)).toBe('light')
    expect(choosePolarity('dark', spotted, TONES, TARGET, LEGIBLE.hysteresis)).toBe('light')
    // And the mirror image: mostly white with a few black shapes.
    const inked = regionStats(
      backdrop(40, 20, (x) => (x % 10 === 0 ? [0, 0, 0] : [250, 250, 250])),
      WHOLE,
    )
    expect(choosePolarity(null, inked, TONES, TARGET, LEGIBLE.hysteresis)).toBe('dark')
    expect(choosePolarity('light', inked, TONES, TARGET, LEGIBLE.hysteresis)).toBe('dark')
  })

  it('still holds the tone over even stripes read from pixels', () => {
    const zebra = regionStats(
      backdrop(40, 20, (x) => (x % 2 === 0 ? [0, 0, 0] : [255, 255, 255])),
      WHOLE,
    )
    expect(choosePolarity('light', zebra, TONES, TARGET, LEGIBLE.hysteresis)).toBe('light')
    expect(choosePolarity('dark', zebra, TONES, TARGET, LEGIBLE.hysteresis)).toBe('dark')
  })

  it('does flip when the other tone is clearly better', () => {
    expect(choosePolarity('light', flat(0.8), TONES, TARGET, LEGIBLE.hysteresis)).toBe('dark')
    expect(choosePolarity('dark', flat(0.01), TONES, TARGET, LEGIBLE.hysteresis)).toBe('light')
  })

  it('keeps the current tone over black-and-white stripes, where neither wins', () => {
    const zebra = busy(0, 1)
    expect(choosePolarity('light', zebra, TONES, TARGET, LEGIBLE.hysteresis)).toBe('light')
    expect(choosePolarity('dark', zebra, TONES, TARGET, LEGIBLE.hysteresis)).toBe('dark')
    // ...and the backing does the work: both need a lot.
    const needs = polarityNeeds(zebra, TONES, TARGET)
    expect(needs.light).toBeGreaterThan(0.5)
    expect(needs.dark).toBeGreaterThan(0.5)
  })
})

describe('the accent-color floor', () => {
  const gold = relativeLuminance([201, 162, 39])
  const red = relativeLuminance([196, 30, 30])
  const dark = TONES.dark

  it('passes a color that clears the floor against what is behind it', () => {
    expect(accentPasses(gold, flat(0.01), dark, 0, FLOOR)).toBe(true)
    expect(contrastRatio(gold, 0.01)).toBeGreaterThanOrEqual(FLOOR)
  })

  it('refuses a color that does not', () => {
    // Dark red over a mid-dark scene: under 3:1.
    expect(accentPasses(red, flat(0.06), dark, 0, FLOOR)).toBe(false)
    expect(contrastRatio(red, 0.06)).toBeLessThan(FLOOR)
  })

  it('judges against both ends of a busy background', () => {
    // Gold clears the dark end but not the bright end.
    expect(accentPasses(gold, busy(0, 0.6), dark, 0, FLOOR)).toBe(false)
    expect(accentPasses(gold, busy(0, 0.05), dark, 0, FLOOR)).toBe(true)
  })

  it('counts the backing: behind a dark halo a bright accent passes again', () => {
    const white = flat(1)
    expect(accentPasses(gold, white, dark, 0, FLOOR)).toBe(false)
    expect(accentPasses(gold, white, dark, 1, FLOOR)).toBe(true)
  })

  it('takes the first passing candidate, or none: the word keeps the base color', () => {
    const candidates: Rgb[] = [[196, 30, 30], [201, 162, 39], [255, 240, 200]]
    expect(pickAccent(candidates, flat(0.06), dark, 0, FLOOR)).toEqual([201, 162, 39])
    expect(pickAccent(candidates, flat(0.25), dark, 0, FLOOR)).toEqual([255, 240, 200])
    expect(pickAccent(candidates, flat(0.3), dark, 0, FLOOR)).toBeNull()
    // Over a bright field the dark red clears the floor again, as the darker color.
    expect(pickAccent(candidates, flat(0.5), dark, 0, FLOOR)).toEqual([196, 30, 30])
    expect(pickAccent([], flat(0), dark, 0, FLOOR)).toBeNull()
  })
})

describe('easing the backing', () => {
  it('strengthens fast and relaxes slowly', () => {
    const up = easeBacking(0, 1, 1 / 60, LEGIBLE.attack, LEGIBLE.release)
    const down = 1 - easeBacking(1, 0, 1 / 60, LEGIBLE.attack, LEGIBLE.release)
    expect(up).toBeGreaterThan(down * 3)
  })

  it('never overshoots and settles on the wanted value', () => {
    let s = 0
    for (let i = 0; i < 240; i++) {
      const next = easeBacking(s, 0.7, 1 / 60, LEGIBLE.attack, LEGIBLE.release)
      expect(next).toBeGreaterThanOrEqual(s)
      expect(next).toBeLessThanOrEqual(0.7)
      s = next
    }
    expect(s).toBeCloseTo(0.7, 3)
    expect(easeBacking(0.4, 0.4, 0.1, 14, 2.5)).toBe(0.4)
    expect(easeBacking(0.4, 1, 0, 14, 2.5)).toBe(0.4)
  })

  it('does not flicker under a background that flashes every other sample', () => {
    // Wanted strength alternates 0 / 0.9; the drawn strength stays up.
    let s = 0.9
    let lowest = 1
    for (let i = 0; i < 120; i++) {
      const wanted = Math.floor(i / 4) % 2 === 0 ? 0.9 : 0
      s = easeBacking(s, wanted, 1 / 60, LEGIBLE.attack, LEGIBLE.release)
      lowest = Math.min(lowest, s)
    }
    expect(lowest).toBeGreaterThan(0.65)
  })
})

describe('text tones', () => {
  it('keeps a light text color and a dark background as they are', () => {
    expect(textTones([207, 217, 238], [10, 13, 26])).toEqual({ light: [207, 217, 238], dark: [10, 13, 26] })
  })

  it('lightens a dim text color and darkens a bright background, keeping the hue side', () => {
    const { light, dark } = textTones([196, 30, 30], [120, 60, 30])
    expect(relativeLuminance(light)).toBeGreaterThanOrEqual(0.55)
    expect(light[0]).toBeGreaterThanOrEqual(light[1]) // still reddish
    expect(relativeLuminance(dark)).toBeLessThanOrEqual(0.015)
    expect(dark[0]).toBeGreaterThan(dark[2]) // still warm
  })

  it('always gives two tones that contrast strongly with each other', () => {
    for (const fill of [[0, 0, 0], [90, 107, 143], [255, 255, 255]] as Rgb[]) {
      for (const bg of [[0, 0, 0], [255, 255, 255], [18, 8, 6]] as Rgb[]) {
        const { light, dark } = textTones(fill, bg)
        expect(contrastRatio(relativeLuminance(light), relativeLuminance(dark))).toBeGreaterThan(9)
      }
    }
  })
})
