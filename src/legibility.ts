/**
 * Readable text over any background, decided from the pixels behind it.
 * Pure math over a small sample of the background (src/backdrop.ts takes
 * the sample; src/textLayer.ts draws the result in Canvas 2D).
 *
 * - The text is light or dark. The choice is made when a line enters,
 *   from whichever tone needs less help over what is behind the line,
 *   and held for the line. The previous line's choice is kept unless
 *   the other tone is clearly better (hysteresis), so text never
 *   flickers between the two.
 * - A text-hugging backing in the opposite tone replaces the global
 *   scrim. Its strength is the opacity that tone needs to bring the
 *   worst of the local background to the target contrast: zero over a
 *   calm scene of the right brightness, full over a busy or hostile one.
 * - A palette accent is used for focus words only when it clears the
 *   contrast floor against what is actually behind it.
 *
 * Luminance here is WCAG relative luminance (linear, 0..1); contrast is
 * the WCAG ratio (L1 + 0.05) / (L2 + 0.05), 1..21.
 */

import type { Rgb } from './mapping'

export type Polarity = 'light' | 'dark'

/** A point sample of the background: RGBA bytes, row by row. */
export interface Backdrop {
  width: number
  height: number
  data: Uint8ClampedArray
  /** Bumped on every new sample, so readers can cache per sample. */
  version: number
}

/** A rectangle in view fractions (0..1). */
export interface Region {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** What is behind a line, in relative luminance. */
export interface RegionStats {
  mean: number
  /** The 5th and 95th percentiles: the dark and bright ends that matter. */
  lo: number
  hi: number
  /** hi - lo: how much the background varies under the line. */
  busy: number
  /**
   * How the area is spread over brightness: the share of samples in
   * each of HIST_BINS equal steps of encoded (perceptual) luminance.
   * Absent on hand-made stats; then only the two ends are known.
   */
  hist?: Float32Array
}

export const HIST_BINS = 16

export const BLACK_STATS: RegionStats = { mean: 0, lo: 0, hi: 0, busy: 0 }

const LINEAR = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Linear luminance (in 1/1024 steps) -> histogram bin. */
const BIN_OF = new Uint8Array(1025)

/** sRGB-encode a linear value (0..1 -> 0..1). */
export function encode(linear: number): number {
  const l = Math.max(0, Math.min(1, linear))
  return l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055
}

function decode(encoded: number): number {
  const c = Math.max(0, Math.min(1, encoded))
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

for (let i = 0; i <= 1024; i++) {
  BIN_OF[i] = Math.min(HIST_BINS - 1, Math.floor(encode(i / 1024) * HIST_BINS))
}

export function relativeLuminance(rgb: readonly number[]): number {
  const at = (v: number) => LINEAR[Math.max(0, Math.min(255, Math.round(v)))]
  return 0.2126 * at(rgb[0]) + 0.7152 * at(rgb[1]) + 0.0722 * at(rgb[2])
}

export function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Luminance statistics of the backdrop under a region. `wash` is a flat
 * color the text layer paints over the whole background before the text
 * (the palette tint, and the scrim in the old mode), composited the way
 * the canvas does it. No backdrop means a black background.
 */
export function regionStats(
  backdrop: Backdrop | null,
  region: Region,
  wash: { color: Rgb; alpha: number }[] = [],
): RegionStats {
  if (!backdrop || backdrop.width < 1 || backdrop.height < 1) {
    if (wash.length === 0) return BLACK_STATS
    let rgb: number[] = [0, 0, 0]
    for (const layer of wash) rgb = rgb.map((v, i) => v + (layer.color[i] - v) * layer.alpha)
    const lum = relativeLuminance(rgb)
    return { mean: lum, lo: lum, hi: lum, busy: 0 }
  }
  const { width, height, data } = backdrop
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(region.x0 * width)))
  const x1 = Math.max(x0, Math.min(width - 1, Math.ceil(region.x1 * width) - 1))
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(region.y0 * height)))
  const y1 = Math.max(y0, Math.min(height - 1, Math.ceil(region.y1 * height) - 1))
  const values = new Float32Array((x1 - x0 + 1) * (y1 - y0 + 1))
  const hist = new Float32Array(HIST_BINS)
  let n = 0
  let sum = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4
      let r = data[i]
      let g = data[i + 1]
      let b = data[i + 2]
      for (const layer of wash) {
        r += (layer.color[0] - r) * layer.alpha
        g += (layer.color[1] - g) * layer.alpha
        b += (layer.color[2] - b) * layer.alpha
      }
      const lum =
        0.2126 * LINEAR[Math.round(r)] + 0.7152 * LINEAR[Math.round(g)] + 0.0722 * LINEAR[Math.round(b)]
      values[n++] = lum
      sum += lum
      hist[BIN_OF[Math.round(lum * 1024)]]++
    }
  }
  for (let i = 0; i < HIST_BINS; i++) hist[i] /= n
  values.sort()
  const lo = values[Math.floor((n - 1) * 0.05)]
  const hi = values[Math.ceil((n - 1) * 0.95)]
  return { mean: sum / n, lo, hi, busy: hi - lo, hist }
}

/**
 * The luminance a background of luminance `bg` shows through a backing
 * of luminance `back` at opacity `alpha` (blended the way the canvas
 * blends: in encoded sRGB).
 */
export function throughBacking(bg: number, back: number, alpha: number): number {
  const a = Math.max(0, Math.min(1, alpha))
  return decode(encode(bg) + (encode(back) - encode(bg)) * a)
}

/**
 * How opaque the backing must be (0..1) for text of luminance `text` to
 * reach `target` contrast against the worst of the background: the
 * bright end under light text, the dark end under dark text. 0 means the
 * background already gives it; 1 means even a solid backing is needed
 * (or is not enough).
 */
export function backingNeeded(
  polarity: Polarity,
  stats: RegionStats,
  text: number,
  back: number,
  target: number,
): number {
  if (polarity === 'light') {
    const worst = stats.hi
    const most = (text + 0.05) / target - 0.05 // the brightest surround allowed
    if (worst <= most) return 0
    if (most <= back) return 1
    return Math.min(1, (encode(worst) - encode(most)) / (encode(worst) - encode(back)))
  }
  const worst = stats.lo
  const least = target * (text + 0.05) - 0.05 // the darkest surround allowed
  if (worst >= least) return 0
  if (least >= back) return 1
  return Math.min(1, (encode(least) - encode(worst)) / (encode(back) - encode(worst)))
}

/** Luminances of the two text tones. */
export interface ToneLums {
  light: number
  dark: number
}

/**
 * How much help each tone would need over this background, averaged
 * over the area: a mostly dark scene with a few bright spots asks
 * little of light text and a lot of dark text, although both would need
 * a strong backing somewhere. (Stats without a histogram only know
 * their two ends, and are judged by the worst end.)
 */
export function polarityNeeds(
  stats: RegionStats,
  tones: ToneLums,
  target: number,
): Record<Polarity, number> {
  if (!stats.hist) {
    return {
      light: backingNeeded('light', stats, tones.light, tones.dark, target),
      dark: backingNeeded('dark', stats, tones.dark, tones.light, target),
    }
  }
  const needs = { light: 0, dark: 0 }
  for (let i = 0; i < HIST_BINS; i++) {
    const share = stats.hist[i]
    if (share === 0) continue
    const lum = decode((i + 0.5) / HIST_BINS)
    const here = { mean: lum, lo: lum, hi: lum, busy: 0 }
    needs.light += share * backingNeeded('light', here, tones.light, tones.dark, target)
    needs.dark += share * backingNeeded('dark', here, tones.dark, tones.light, target)
  }
  return needs
}

/**
 * Light or dark text for a line entering over `stats`. With no previous
 * choice: whichever needs less help over the area (light on a tie).
 * With one: keep it unless the other needs less by more than
 * `hysteresis`.
 */
export function choosePolarity(
  previous: Polarity | null,
  stats: RegionStats,
  tones: ToneLums,
  target: number,
  hysteresis: number,
): Polarity {
  const needs = polarityNeeds(stats, tones, target)
  if (previous === null) return needs.light <= needs.dark ? 'light' : 'dark'
  const other: Polarity = previous === 'light' ? 'dark' : 'light'
  return needs[previous] - needs[other] > hysteresis ? other : previous
}

/**
 * Whether an accent color clears `floor` against what is behind it: the
 * local background as it shows through a backing of the given strength,
 * at both its dark and its bright end.
 */
export function accentPasses(
  accent: number,
  stats: RegionStats,
  back: number,
  strength: number,
  floor: number,
): boolean {
  const lo = throughBacking(stats.lo, back, strength)
  const hi = throughBacking(stats.hi, back, strength)
  return Math.min(contrastRatio(accent, lo), contrastRatio(accent, hi)) >= floor
}

/** The first candidate that passes, or null: the word keeps the base color. */
export function pickAccent(
  candidates: readonly Rgb[],
  stats: RegionStats,
  back: number,
  strength: number,
  floor: number,
): Rgb | null {
  for (const candidate of candidates) {
    if (accentPasses(relativeLuminance(candidate), stats, back, strength, floor)) return candidate
  }
  return null
}

/**
 * Move the backing toward what the background now requires: quickly
 * when it must get stronger, slowly when it may relax. Rates are per
 * second.
 */
export function easeBacking(
  current: number,
  wanted: number,
  dt: number,
  attack: number,
  release: number,
): number {
  const rate = wanted > current ? attack : release
  return current + (wanted - current) * (1 - Math.exp(-rate * Math.max(0, dt)))
}

const LIGHT_MIN = 0.55
const DARK_MAX = 0.015

/**
 * The two text tones for a section: its own text color, lightened only
 * if it is too dim to serve as light text, and its own background
 * color, darkened only if it is too bright to serve as dark text.
 */
export function textTones(fill: Rgb, background: Rgb): { light: Rgb; dark: Rgb } {
  let light: Rgb = [fill[0], fill[1], fill[2]]
  for (let step = 0; step < 20 && relativeLuminance(light) < LIGHT_MIN; step++) {
    light = [
      light[0] + (255 - light[0]) * 0.15,
      light[1] + (255 - light[1]) * 0.15,
      light[2] + (255 - light[2]) * 0.15,
    ]
  }
  let dark: Rgb = [background[0], background[1], background[2]]
  for (let step = 0; step < 20 && relativeLuminance(dark) > DARK_MAX; step++) {
    dark = [dark[0] * 0.8, dark[1] * 0.8, dark[2] * 0.8]
  }
  return {
    light: [Math.round(light[0]), Math.round(light[1]), Math.round(light[2])],
    dark: [Math.round(dark[0]), Math.round(dark[1]), Math.round(dark[2])],
  }
}
