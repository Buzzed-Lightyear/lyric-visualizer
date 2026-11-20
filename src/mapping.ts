/**
 * The mapping layer: pure semantics -> SceneParams. The renderer receives
 * only (AudioFrame, SceneParams, dt); it never sees raw semantics, and
 * nothing here animates by itself. Audio decides WHEN, this decides WHAT
 * and how much. One hardcoded mapping; presets and seeds are step 5.
 */

import { motionForAxes, nearestAnchor, sectionAxes } from './axes'
import type { GestureAssignment } from './gestures'
import type { AnchorName, LayoutName } from './layout'
import type { EntranceName, ExitName, HoldName } from './parts'
import type { SemanticSection, SongLook } from './semantics'
import { MAPPING, SCENE, TEXT } from './tuning'
import type { VoiceName } from './voiceNames'

// The axes and their anchors live in src/axes.ts; re-exported for callers
// that only know the mapping layer.
export { moodAxes, NEUTRAL_AXES, type MoodAxes } from './axes'

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

/**
 * A free-text tag's motif: the whole tag first, then each of its words
 * (also tried with and without a plural "s"), so "cold rain" still
 * lands on rain.
 */
function motifForFreeTag(tag: string): Motif | undefined {
  for (const word of tag.split(/[^a-z]+/)) {
    if (word === '') continue
    for (const form of [word, `${word}s`, word.replace(/s$/, '')]) {
      if (Object.hasOwn(IMAGERY_TO_MOTIF, form)) return IMAGERY_TO_MOTIF[form]
    }
  }
  return undefined
}

/**
 * First imagery tag with a motif wins; none of them -> haze. `freeText`
 * (version 3 sections, whose tags are free text) also matches a tag by
 * its words; without it only whole tags match, as they always did.
 */
export function chooseMotif(
  imagery: readonly string[],
  freeText = false,
): {
  motif: Motif
  tag: string | null
} {
  for (const tag of imagery) {
    const key = tag.toLowerCase()
    const motif = Object.hasOwn(IMAGERY_TO_MOTIF, key)
      ? IMAGERY_TO_MOTIF[key]
      : freeText
        ? motifForFreeTag(key)
        : undefined
    if (motif) return { motif, tag }
  }
  return { motif: 'haze', tag: null }
}

/** The motif for a section; version 3 sections (own axes) carry free-text tags. */
export function motifForSection(section: SemanticSection | null): {
  motif: Motif
  tag: string | null
} {
  return chooseMotif(section?.imagery ?? [], section?.axes !== undefined)
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
  /** The section's block anchor. */
  anchor: AnchorName
  /** Word indices set larger and heavier (hierarchy). */
  focus: number[]
  /** Gestures performed by single words, starting at their onsets. */
  gestures: GestureAssignment[]
  fill: Rgb
  accent: Rgb
  tint: Rgb
  /** The section's background color: the source of the dark text tone. */
  background: Rgb
  /**
   * Accent colors a focus word may take, in order of preference: the
   * section's own accent, then the rest of the song's palette. One is
   * used only if it clears the contrast floor (src/legibility.ts).
   */
  accents: Rgb[]
  /** Energy -> how hard forces act. */
  forceScale: number
  /** Emphasis -> size multiplier on the base font size. */
  sizeScale: number
  /** Emphasis -> scrim strength under the text. */
  scrim: number
  emphasis: number
}

/** Calm at the left, violent at the right; energy indexes into it. */
export const ENTRANCE_LADDER: EntranceName[] = [
  'unfold', 'buoy', 'pop', 'creep', 'hang', 'assemble', 'fall', 'fling', 'whip', 'slam',
]

/** Each hold's natural exit: the section's one way out. */
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

/**
 * The section's base motion: one entrance, hold, exit, voice and anchor,
 * fixed for the whole section. Motion changes only when meaning changes —
 * nothing here varies per line.
 *
 * The entrance comes from energy; hold and anchor from the nearest mood
 * anchor to the section's axes (src/axes.ts). The two voices come from
 * the song's look when it has one — the section says which of them it is
 * set in — and from the nearest mood anchor otherwise (version 1 and 2).
 */
export interface SectionGrammar {
  entrance: EntranceName
  hold: HoldName
  exit: ExitName
  voice: VoiceName
  accentVoice: VoiceName
  anchor: AnchorName
}

export function sectionGrammar(
  section: SemanticSection | null,
  look: SongLook | null = null,
): SectionGrammar {
  const style = nearestAnchor(sectionAxes(section)).anchor
  const energy = Math.max(0, Math.min(1, section?.energy ?? 0.5))
  const entrance = ENTRANCE_LADDER[Math.round(energy * (ENTRANCE_LADDER.length - 1))]
  return {
    entrance,
    hold: style.hold,
    exit: DEFAULT_EXIT[style.hold],
    voice: look ? look.voices[section?.voice ?? 'main'] : style.voice,
    accentVoice: look ? look.voices.accent : style.accentVoice,
    anchor: style.anchor,
  }
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
const NEUTRAL_BACKGROUND: Rgb = [8, 10, 18]

/** Per-line choreography: the base grammar (a refrain reuses its source
 * line's), plus the focus words and the gestures they perform. */
export interface LineMotion {
  grammar?: SectionGrammar
  focus?: readonly number[]
  gestures?: readonly GestureAssignment[]
}

/**
 * Pure and deterministic: the same section, emphasis and motion always
 * produce the same params. The grammar is fixed per section; only the
 * line's own meaning (emphasis, focus, gestures) varies.
 */
export function textParamsForLine(
  section: SemanticSection | null,
  emphasis: number,
  motion: LineMotion = {},
  look: SongLook | null = null,
): TextParams {
  const grammar = motion.grammar ?? sectionGrammar(section, look)
  const energy = section?.energy ?? 0.5
  const palette = section?.palette.map(hexToRgb)
  const accent = palette?.[3] ?? palette?.[1] ?? NEUTRAL_ACCENT
  const accents: Rgb[] = [accent]
  for (const color of (look?.palette ?? []).slice(1).map(hexToRgb)) {
    if (!accents.some((have) => have.every((v, i) => v === color[i]))) accents.push(color)
  }
  return {
    // Lines at emphasis 0.85 or above switch to the accent voice.
    voice: emphasis >= TEXT.shatterEmphasis ? grammar.accentVoice : grammar.voice,
    entrance: grammar.entrance,
    hold: grammar.hold,
    exit: grammar.exit,
    layout: layoutForLine(emphasis),
    anchor: grammar.anchor,
    focus: [...(motion.focus ?? [])],
    gestures: [...(motion.gestures ?? [])],
    fill: palette?.[2] ?? NEUTRAL_FILL,
    accent,
    tint: palette?.[1] ?? NEUTRAL_TINT,
    background: palette?.[0] ?? NEUTRAL_BACKGROUND,
    accents,
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
  const motion = motionForAxes(sectionAxes(section))
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
    motif: motifForSection(section).motif,
  }
}
