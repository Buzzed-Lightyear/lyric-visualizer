/**
 * The mapping layer: pure semantics -> SceneParams. The renderer receives
 * only (AudioFrame, SceneParams, dt); it never sees raw semantics, and
 * nothing here animates by itself. Audio decides WHEN, this decides WHAT
 * and how much. One hardcoded mapping; presets and seeds are step 5.
 */

import type { LayoutName } from './layout'
import type { EntranceName, ExitName, HoldName } from './parts'
import type { SemanticSection } from './semantics'
import { MAPPING, SCENE, TEXT } from './tuning'
import type { VoiceName } from './voices'

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
  voice: VoiceName
  entrance: EntranceName
  hold: HoldName
  exit: ExitName
  layout: LayoutName
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
}

interface MoodText {
  hold: HoldName
  voice: VoiceName
  /** Lines at high emphasis may switch to this voice. */
  accentVoice: VoiceName
}

const DEFAULT_TEXT: MoodText = { hold: 'bob', voice: 'air', accentVoice: 'marker' }

/** Mood -> hold part and type voice. Unknown moods get the default. */
const MOOD_TEXT: Record<string, MoodText> = {
  calm: { hold: 'bob', voice: 'air', accentVoice: 'condensed' },
  mournful: { hold: 'bob', voice: 'whisper', accentVoice: 'condensed' },
  suspended: { hold: 'still', voice: 'air', accentVoice: 'condensed' },
  tense: { hold: 'tremble', voice: 'mono', accentVoice: 'marker' },
  menacing: { hold: 'jolt', voice: 'condensed', accentVoice: 'marker' },
  furious: { hold: 'jolt', voice: 'block', accentVoice: 'marker' },
  weary: { hold: 'pendulum', voice: 'slab', accentVoice: 'marker' },
  grieving: { hold: 'still', voice: 'serif', accentVoice: 'condensed' },
  brooding: { hold: 'pendulum', voice: 'serif', accentVoice: 'marker' },
  hollow: { hold: 'still', voice: 'mono', accentVoice: 'condensed' },
}

/** The four background axes a mood maps onto (all 0..1). */
export interface MoodAxes {
  /** Calm to intense. */
  arousal: number
  /** Dark and heavy to bright and uplifting. */
  valence: number
  /** Smooth to harsh or chaotic. */
  tension: number
  /** Cool to warm. */
  warmth: number
}

export const NEUTRAL_AXES: MoodAxes = { arousal: 0.5, valence: 0.5, tension: 0.5, warmth: 0.5 }

const MOOD_AXES: Record<string, MoodAxes> = {
  calm: { arousal: 0.2, valence: 0.6, tension: 0.2, warmth: 0.5 },
  mournful: { arousal: 0.25, valence: 0.3, tension: 0.3, warmth: 0.35 },
  suspended: { arousal: 0.3, valence: 0.5, tension: 0.35, warmth: 0.4 },
  tense: { arousal: 0.6, valence: 0.35, tension: 0.75, warmth: 0.45 },
  menacing: { arousal: 0.7, valence: 0.2, tension: 0.8, warmth: 0.55 },
  furious: { arousal: 0.95, valence: 0.15, tension: 0.9, warmth: 0.75 },
  weary: { arousal: 0.35, valence: 0.35, tension: 0.4, warmth: 0.5 },
  grieving: { arousal: 0.3, valence: 0.2, tension: 0.45, warmth: 0.35 },
  brooding: { arousal: 0.45, valence: 0.25, tension: 0.55, warmth: 0.45 },
  hollow: { arousal: 0.3, valence: 0.3, tension: 0.5, warmth: 0.3 },
}

/** Unknown mood words are neutral. */
export function moodAxes(mood: string | null): MoodAxes {
  return (mood && MOOD_AXES[mood.toLowerCase()]) || NEUTRAL_AXES
}

/** Calm at the left, violent at the right; energy indexes into it. */
export const ENTRANCE_LADDER: EntranceName[] = [
  'unfold', 'buoy', 'pop', 'creep', 'hang', 'assemble', 'fall', 'fling', 'whip', 'slam',
]

/** Each hold's natural exit, for mid-emphasis lines. */
const DEFAULT_EXIT: Record<HoldName, ExitName> = {
  jolt: 'tumble',
  rest: 'collapse',
  bob: 'liftOff',
  tremble: 'tumble',
  pendulum: 'tumble',
  pulse: 'tumble',
  wave: 'blow',
  still: 'sink',
}

function lineHash(lineStart: number): number {
  return (Math.abs(Math.round(lineStart * 100)) * 2654435761) >>> 0
}

/**
 * Energy picks a 3-wide window on the ladder (calmer at low energy,
 * violent at high); the line's hash picks within it, shifting once if
 * the previous line would have landed on the same entrance.
 */
export function entranceForLine(
  energy: number,
  lineStart: number | null,
  prevLineStart: number | null,
): EntranceName {
  const n = ENTRANCE_LADDER.length
  const center = Math.round(Math.max(0, Math.min(1, energy)) * (n - 1))
  const lo = Math.max(0, Math.min(n - 3, center - 1))
  const window = ENTRANCE_LADDER.slice(lo, lo + 3)
  if (lineStart === null) return window[1]
  const pick = (t: number) => window[lineHash(t) % 3]
  let choice = pick(lineStart)
  if (prevLineStart !== null && pick(prevLineStart) === choice) {
    choice = window[(lineHash(lineStart) + 1) % 3]
  }
  return choice
}

/** Emphasis -> exit: shatter/knock at the top, sink/blow at the bottom. */
export function exitForLine(emphasis: number, hold: HoldName, lineStart: number | null): ExitName {
  const hash = lineHash(lineStart ?? 0)
  if (emphasis >= TEXT.shatterEmphasis) return hash % 2 === 0 ? 'shatter' : 'knock'
  if (emphasis <= 0.3) return hash % 2 === 0 ? 'sink' : 'blow'
  return DEFAULT_EXIT[hold]
}

/** Emphasis -> layout. Focus still needs the pace gate in the layer. */
export function layoutForLine(emphasis: number): LayoutName {
  if (emphasis >= 0.8) return 'focus'
  if (emphasis >= 0.65) return 'lockup'
  return 'centered'
}

const NEUTRAL_FILL: Rgb = [232, 238, 248]
const NEUTRAL_ACCENT: Rgb = [255, 180, 90]
const NEUTRAL_TINT: Rgb = [255, 148, 64]

/**
 * Pure and deterministic: the same section, emphasis and line always
 * produce the same parts. `prevLineStart` only breaks entrance repeats.
 */
export function textParamsForLine(
  section: SemanticSection | null,
  emphasis: number,
  lineStart: number | null,
  prevLineStart: number | null,
): TextParams {
  const style = section ? (MOOD_TEXT[section.mood.toLowerCase()] ?? DEFAULT_TEXT) : DEFAULT_TEXT
  const energy = section?.energy ?? 0.5
  const palette = section?.palette.map(hexToRgb)
  return {
    voice: emphasis >= TEXT.shatterEmphasis ? style.accentVoice : style.voice,
    entrance: entranceForLine(energy, lineStart, prevLineStart),
    hold: style.hold,
    exit: exitForLine(emphasis, style.hold, lineStart),
    layout: layoutForLine(emphasis),
    fill: palette?.[2] ?? NEUTRAL_FILL,
    accent: palette?.[3] ?? palette?.[1] ?? NEUTRAL_ACCENT,
    tint: palette?.[1] ?? NEUTRAL_TINT,
    forceScale: TEXT.forceBase + energy * TEXT.forceEnergy,
    sizeScale: 0.75 + emphasis * 0.5,
    scrim: Math.min(1, TEXT.scrimBase + emphasis * TEXT.scrimEmphasis),
    emphasis,
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
