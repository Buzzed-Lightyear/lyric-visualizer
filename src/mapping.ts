/**
 * The mapping layer: pure semantics -> SceneParams. The renderer receives
 * only (AudioFrame, SceneParams, dt); it never sees raw semantics, and
 * nothing here animates by itself. Audio decides WHEN, this decides WHAT
 * and how much. One hardcoded mapping; presets and seeds are step 5.
 */

import type { SemanticSection } from './semantics'
import { MAPPING, SCENE, type Motif } from './tuning'

export type Rgb = [number, number, number]

export interface SceneParams {
  background: Rgb
  glowColor: Rgb
  particleColor: Rgb
  ringColor: Rgb
  /** Absolute particle count (capped by the scene's pool). */
  particleCount: number
  /** Multipliers on the step 2 baselines; 1 = step 2 look. */
  speed: number
  glowScale: number
  jitter: number
  /** Vertical drift bias: positive rises, negative sinks. */
  lift: number
  /** How hard audio accents (beat kicks) land. 1 = step 2. */
  accent: number
  motif: Motif
}

/** Reproduces the step 2 look exactly; used between sections and with S off. */
export const NEUTRAL_PARAMS: SceneParams = {
  background: [8, 10, 18],
  glowColor: [255, 148, 64],
  particleColor: [168, 200, 255],
  ringColor: [255, 180, 90],
  particleCount: SCENE.particleCount,
  speed: 1,
  glowScale: 1,
  jitter: 1,
  lift: 0,
  accent: 1,
  motif: 'drift',
}

const NEUTRAL_MOTION = { jitter: 1, lift: 0 }

/** Motion character per mood. Unknown moods get neutral motion. */
const MOODS: Record<string, { jitter: number; lift: number }> = {
  calm: { jitter: 0.5, lift: 0.1 },
  tense: { jitter: 1.4, lift: 0 },
  menacing: { jitter: 1.6, lift: -0.15 },
  furious: { jitter: 2, lift: -0.1 },
  weary: { jitter: 0.7, lift: -0.25 },
  grieving: { jitter: 0.55, lift: -0.4 },
  mournful: { jitter: 0.6, lift: 0.25 },
  brooding: { jitter: 0.9, lift: -0.15 },
  hollow: { jitter: 0.5, lift: 0 },
  suspended: { jitter: 0.4, lift: 0.3 },
}

/**
 * Only the motifs this song's imagery needs. Near-synonyms land on the
 * closest motif; any unlisted tag falls through to the step 2 drift.
 */
const IMAGERY_TO_MOTIF: Record<string, Motif> = {
  embers: 'embers',
  fire: 'embers',
  sparks: 'embers',
  gunmetal: 'embers',
  sirens: 'embers',
  rain: 'rain',
  storm: 'rain',
  tears: 'rain',
  stars: 'stars',
  'night-sky': 'stars',
  prayer: 'stars',
}

/** First imagery tag with a motif wins; none of them -> drift. */
export function chooseMotif(imagery: readonly string[]): {
  motif: Motif
  tag: string | null
} {
  for (const tag of imagery) {
    const motif = IMAGERY_TO_MOTIF[tag.toLowerCase()]
    if (motif) return { motif, tag }
  }
  return { motif: 'drift', tag: null }
}

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Linear blend from the value at 0 to the value at 1. */
function span(atZero: number, atFull: number, t: number): number {
  return atZero + (atFull - atZero) * t
}

/**
 * Pure and deterministic: the same section and emphasis always produce
 * the same params.
 */
export function paramsForSection(
  section: SemanticSection | null,
  emphasis: number,
): SceneParams {
  if (!section) return NEUTRAL_PARAMS
  const motion = MOODS[section.mood.toLowerCase()] ?? NEUTRAL_MOTION
  const palette = section.palette.map(hexToRgb)
  return {
    background: palette[0],
    glowColor: palette[1],
    particleColor: palette[2],
    ringColor: palette[3] ?? palette[1],
    particleCount:
      SCENE.particleCount * span(MAPPING.countAtZero, MAPPING.countAtFull, section.energy),
    speed: span(MAPPING.speedAtZero, MAPPING.speedAtFull, section.energy),
    glowScale: span(MAPPING.glowAtZero, MAPPING.glowAtFull, section.energy),
    jitter: motion.jitter,
    lift: motion.lift,
    accent: span(MAPPING.accentAtZero, MAPPING.accentAtFull, emphasis),
    motif: chooseMotif(section.imagery).motif,
  }
}

/** Eases every numeric field toward the target so section changes look intended. */
export class ParamEaser {
  private readonly current: SceneParams = {
    ...NEUTRAL_PARAMS,
    background: [...NEUTRAL_PARAMS.background],
    glowColor: [...NEUTRAL_PARAMS.glowColor],
    particleColor: [...NEUTRAL_PARAMS.particleColor],
    ringColor: [...NEUTRAL_PARAMS.ringColor],
  }

  step(target: SceneParams, dt: number): SceneParams {
    const k = 1 - Math.exp(-dt / MAPPING.easeTau)
    const c = this.current
    const numbers = ['particleCount', 'speed', 'glowScale', 'jitter', 'lift', 'accent'] as const
    for (const key of numbers) c[key] += (target[key] - c[key]) * k
    const colors = ['background', 'glowColor', 'particleColor', 'ringColor'] as const
    for (const key of colors) {
      for (let i = 0; i < 3; i++) c[key][i] += (target[key][i] - c[key][i]) * k
    }
    c.motif = target.motif
    return c
  }
}
