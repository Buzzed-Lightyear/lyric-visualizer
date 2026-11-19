/**
 * The mapping layer: pure semantics -> SceneParams. The renderer receives
 * only (AudioFrame, SceneParams, dt); it never sees raw semantics, and
 * nothing here animates by itself. Audio decides WHEN, this decides WHAT
 * and how much. One hardcoded mapping; presets and seeds are step 5.
 */

import type { BehaviorName } from './behaviors'
import type { SemanticSection } from './semantics'
import { MAPPING, SCENE, TEXT } from './tuning'

export type Motif = 'drift' | 'embers' | 'rain' | 'stars' | 'haze'

export type Rgb = [number, number, number]

export interface SceneParams {
  /** Identity of the section these params came from; a change starts a transition. */
  key: string
  /** The section's 0..1 energy; paces transitions. */
  energy: number
  background: Rgb
  glowColor: Rgb
  particleColor: Rgb
  ringColor: Rgb
  /** Absolute particle count for count-driven motifs. */
  particleCount: number
  /** Multipliers on the step 2 baselines; 1 = step 2 look. */
  speed: number
  glowScale: number
  jitter: number
  /** Vertical drift bias: positive rises, negative sinks. */
  lift: number
  /** How hard audio accents (beat kicks, glow, size) land. 1 = step 2. */
  accent: number
  motif: Motif
}

/** Reproduces the step 2 look exactly; used between sections and with S off. */
export const NEUTRAL_PARAMS: SceneParams = {
  key: 'neutral',
  energy: 0.5,
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
 * closest motif; any unlisted tag falls through to haze (the most
 * generic). Drift is reserved for the neutral look.
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
  haze: 'haze',
  smoke: 'haze',
  'city-night': 'haze',
  streetlights: 'haze',
  fluorescent: 'haze',
  fog: 'haze',
}

/** First imagery tag with a motif wins; none of them -> haze. */
export function chooseMotif(imagery: readonly string[]): {
  motif: Motif
  tag: string | null
} {
  for (const tag of imagery) {
    const motif = IMAGERY_TO_MOTIF[tag.toLowerCase()]
    if (motif) return { motif, tag }
  }
  return { motif: 'haze', tag: null }
}

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Linear blend from the value at 0 to the value at 1. */
function span(atZero: number, atFull: number, t: number): number {
  return atZero + (atFull - atZero) * t
}

// --- kinetic typography ------------------------------------------------------

export interface TextParams {
  behavior: BehaviorName
  /** Heavy display face vs the light one. */
  heavy: boolean
  caps: boolean
  /** Letter tracking in ems. */
  tracking: number
  fill: Rgb
  accent: Rgb
  tint: Rgb
  /** Energy -> how hard forces act. */
  forceScale: number
  /** Emphasis -> size multiplier on the base font size. */
  sizeScale: number
  /** Emphasis -> scrim strength under the text. */
  scrim: number
  emphasis: number
  /** Emphasis >= TEXT.shatterEmphasis: the line exits by shattering. */
  shatterExit: boolean
}

interface MoodText {
  behavior: BehaviorName
  heavy: boolean
  caps: boolean
  tracking: number
}

const DEFAULT_TEXT: MoodText = { behavior: 'float', heavy: false, caps: false, tracking: 0.08 }

/** Mood -> default behavior and type style. Unknown moods get the default. */
const MOOD_TEXT: Record<string, MoodText> = {
  calm: { behavior: 'float', heavy: false, caps: false, tracking: 0.1 },
  mournful: { behavior: 'float', heavy: false, caps: false, tracking: 0.12 },
  suspended: { behavior: 'float', heavy: false, caps: false, tracking: 0.15 },
  tense: { behavior: 'tremble', heavy: true, caps: false, tracking: 0.02 },
  menacing: { behavior: 'slam', heavy: true, caps: true, tracking: 0.04 },
  furious: { behavior: 'slam', heavy: true, caps: true, tracking: 0.02 },
  weary: { behavior: 'swing', heavy: false, caps: false, tracking: 0.06 },
  grieving: { behavior: 'drop', heavy: false, caps: false, tracking: 0.08 },
  brooding: { behavior: 'swing', heavy: true, caps: false, tracking: 0.05 },
  hollow: { behavior: 'drop', heavy: false, caps: false, tracking: 0.2 },
}

const NEUTRAL_FILL: Rgb = [232, 238, 248]
const NEUTRAL_ACCENT: Rgb = [255, 180, 90]
const NEUTRAL_TINT: Rgb = [255, 148, 64]

/** Pure, like paramsForSection: same section + emphasis, same params. */
export function textParamsForSection(
  section: SemanticSection | null,
  emphasis: number,
): TextParams {
  const style = section ? (MOOD_TEXT[section.mood.toLowerCase()] ?? DEFAULT_TEXT) : DEFAULT_TEXT
  const energy = section?.energy ?? 0.5
  const palette = section?.palette.map(hexToRgb)
  return {
    behavior: style.behavior,
    heavy: style.heavy,
    caps: style.caps,
    tracking: style.tracking,
    fill: palette?.[2] ?? NEUTRAL_FILL,
    accent: palette?.[3] ?? palette?.[1] ?? NEUTRAL_ACCENT,
    tint: palette?.[1] ?? NEUTRAL_TINT,
    forceScale: TEXT.forceBase + energy * TEXT.forceEnergy,
    sizeScale: 0.75 + emphasis * 0.5,
    scrim: Math.min(1, TEXT.scrimBase + emphasis * TEXT.scrimEmphasis),
    emphasis,
    shatterExit: emphasis >= TEXT.shatterEmphasis,
  }
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
    key: `${section.label}@${section.start}`,
    energy: section.energy,
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
