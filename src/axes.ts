/**
 * The four mood axes and the anchor points that turn them into motion
 * and type. Up to semantics version 2 the renderer keyed off ten mood
 * words; from version 3 the mood is free text and each section carries
 * its axes as numbers. The ten words survive here as ANCHORS: named
 * points in axes space, each holding the motion and type the word used
 * to select.
 *
 * - A section with explicit axes is placed by them.
 * - A section without axes (version 1 and 2 files) sits exactly on its
 *   mood word's anchor, or on the neutral anchor for an unknown word,
 *   so old files map to exactly the result they always had.
 * - Continuous values (jitter, lift) blend between anchors by inverse
 *   distance: exact on an anchor, continuous everywhere.
 * - Categorical values (hold, type voice, block anchor) come from the
 *   nearest anchor.
 *
 * Pure module: no DOM, no fonts.
 */

import type { AnchorName } from './layout'
import type { HoldName } from './parts'
import type { VoiceName } from './voiceNames'

/** The four axes a mood maps onto (all 0..1). Same scale as the preset catalog. */
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

export const AXIS_NAMES = ['arousal', 'valence', 'tension', 'warmth'] as const

export const NEUTRAL_AXES: MoodAxes = { arousal: 0.5, valence: 0.5, tension: 0.5, warmth: 0.5 }

/** What one anchor point selects. */
export interface MoodAnchor {
  axes: MoodAxes
  /** Canvas-scene motion character: smooth vs jittery, sinking vs rising. */
  jitter: number
  lift: number
  /** The section's hold part. */
  hold: HoldName
  /** Type voices, used by files that carry no song-level look. */
  voice: VoiceName
  accentVoice: VoiceName
  /** The section's block anchor on screen. */
  anchor: AnchorName
}

/**
 * The ten version 2 mood words, plus "neutral" for everything the old
 * tables did not know. Values are the old MOODS, MOOD_TEXT and MOOD_AXES
 * tables, merged row by row and otherwise unchanged.
 */
export const MOOD_ANCHORS: Record<string, MoodAnchor> = {
  neutral: {
    axes: NEUTRAL_AXES,
    jitter: 1, lift: 0,
    hold: 'bob', voice: 'air', accentVoice: 'marker', anchor: 'center',
  },
  calm: {
    axes: { arousal: 0.2, valence: 0.6, tension: 0.2, warmth: 0.5 },
    jitter: 0.5, lift: 0.1,
    hold: 'bob', voice: 'air', accentVoice: 'condensed', anchor: 'center',
  },
  mournful: {
    axes: { arousal: 0.25, valence: 0.3, tension: 0.3, warmth: 0.35 },
    jitter: 0.6, lift: 0.25,
    hold: 'bob', voice: 'whisper', accentVoice: 'condensed', anchor: 'center',
  },
  suspended: {
    axes: { arousal: 0.3, valence: 0.5, tension: 0.35, warmth: 0.4 },
    jitter: 0.4, lift: 0.3,
    hold: 'still', voice: 'air', accentVoice: 'condensed', anchor: 'center',
  },
  tense: {
    axes: { arousal: 0.6, valence: 0.35, tension: 0.75, warmth: 0.45 },
    jitter: 1.4, lift: 0,
    hold: 'tremble', voice: 'mono', accentVoice: 'marker', anchor: 'upperLeft',
  },
  menacing: {
    axes: { arousal: 0.7, valence: 0.2, tension: 0.8, warmth: 0.55 },
    jitter: 1.6, lift: -0.15,
    hold: 'jolt', voice: 'condensed', accentVoice: 'marker', anchor: 'low',
  },
  furious: {
    axes: { arousal: 0.95, valence: 0.15, tension: 0.9, warmth: 0.75 },
    jitter: 2, lift: -0.1,
    hold: 'jolt', voice: 'block', accentVoice: 'marker', anchor: 'center',
  },
  weary: {
    axes: { arousal: 0.35, valence: 0.35, tension: 0.4, warmth: 0.5 },
    jitter: 0.7, lift: -0.25,
    hold: 'pendulum', voice: 'slab', accentVoice: 'marker', anchor: 'low',
  },
  grieving: {
    axes: { arousal: 0.3, valence: 0.2, tension: 0.45, warmth: 0.35 },
    jitter: 0.55, lift: -0.4,
    hold: 'still', voice: 'serif', accentVoice: 'condensed', anchor: 'center',
  },
  brooding: {
    axes: { arousal: 0.45, valence: 0.25, tension: 0.55, warmth: 0.45 },
    jitter: 0.9, lift: -0.15,
    hold: 'pendulum', voice: 'serif', accentVoice: 'marker', anchor: 'low',
  },
  hollow: {
    axes: { arousal: 0.3, valence: 0.3, tension: 0.5, warmth: 0.3 },
    jitter: 0.5, lift: 0,
    hold: 'still', voice: 'mono', accentVoice: 'condensed', anchor: 'upperLeft',
  },
}

export const ANCHOR_NAMES = Object.keys(MOOD_ANCHORS)

/**
 * How sharply the blend favours the nearest anchor. Not a look knob:
 * it only decides how far an anchor's motion reaches between anchors.
 */
const BLEND_POWER = 4

/** Below this distance a point counts as sitting on the anchor. */
const ON_ANCHOR = 1e-9

export function isAxes(value: unknown): value is MoodAxes {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const raw = value as Record<string, unknown>
  return AXIS_NAMES.every((axis) => {
    const v = raw[axis]
    return typeof v === 'number' && v >= 0 && v <= 1
  })
}

/** The axes a mood word stands for; unknown words are neutral. */
export function moodAxes(mood: string | null): MoodAxes {
  if (!mood) return NEUTRAL_AXES
  const key = mood.toLowerCase()
  return Object.hasOwn(MOOD_ANCHORS, key) ? MOOD_ANCHORS[key].axes : NEUTRAL_AXES
}

/**
 * Where a section sits in axes space: its own axes when it carries
 * them (version 3), else its mood word's anchor (versions 1 and 2).
 */
export function sectionAxes(
  section: { mood: string; axes?: MoodAxes } | null,
): MoodAxes {
  if (!section) return NEUTRAL_AXES
  return section.axes ?? moodAxes(section.mood)
}

export function axesDistance(a: MoodAxes, b: MoodAxes): number {
  return Math.hypot(
    a.arousal - b.arousal,
    a.valence - b.valence,
    a.tension - b.tension,
    a.warmth - b.warmth,
  )
}

/** The closest anchor; ties go to the earlier one in MOOD_ANCHORS. */
export function nearestAnchor(axes: MoodAxes): { name: string; anchor: MoodAnchor } {
  let best = ANCHOR_NAMES[0]
  let bestDistance = Infinity
  for (const name of ANCHOR_NAMES) {
    const distance = axesDistance(axes, MOOD_ANCHORS[name].axes)
    if (distance < bestDistance - 1e-12) {
      best = name
      bestDistance = distance
    }
  }
  return { name: best, anchor: MOOD_ANCHORS[best] }
}

/**
 * Jitter and lift at any point of axes space: an inverse-distance blend
 * of every anchor. On an anchor it returns that anchor's values exactly;
 * between anchors it moves continuously and never leaves their range.
 */
export function motionForAxes(axes: MoodAxes): { jitter: number; lift: number } {
  let weightSum = 0
  let jitter = 0
  let lift = 0
  for (const name of ANCHOR_NAMES) {
    const anchor = MOOD_ANCHORS[name]
    const distance = axesDistance(axes, anchor.axes)
    if (distance < ON_ANCHOR) return { jitter: anchor.jitter, lift: anchor.lift }
    const weight = 1 / distance ** BLEND_POWER
    weightSum += weight
    jitter += weight * anchor.jitter
    lift += weight * anchor.lift
  }
  return { jitter: jitter / weightSum, lift: lift / weightSum }
}
