/**
 * Gestures: named moves a word performs when a line's meaning calls for
 * one. Each is a recipe over the existing entrance and hold parts (plus
 * a few word-level modifiers); no new physics. A gesture starts at its
 * word's estimated onset, and only the words that carry the line perform
 * it — everything else follows the section's base motion.
 *
 * Gestures come from a `direction` in the semantics file (authored, per
 * line) or, when a line has none, from the word-stem lexicon below.
 */

import type { EntranceName, HoldName } from './parts'
import { GESTURE_T } from './tuning'

export type GestureName =
  | 'fall'
  | 'rise'
  | 'strike'
  | 'break'
  | 'drift'
  | 'tremble'
  | 'swell'
  | 'shrink'
  | 'rush'
  | 'halt'
  | 'apart'
  | 'together'
  | 'echo'
  | 'hang'
  | 'linger'

export const GESTURE_NAMES: GestureName[] = [
  'fall', 'rise', 'strike', 'break', 'drift', 'tremble', 'swell', 'shrink',
  'rush', 'halt', 'apart', 'together', 'echo', 'hang', 'linger',
]

export type DirectionWord = 'left' | 'right' | 'up' | 'down'
export const DIRECTION_WORDS: DirectionWord[] = ['left', 'right', 'up', 'down']

export interface GestureRecipe {
  entrance: EntranceName
  hold: HoldName
  /** Multiplier on the hold's audio-driven forces. */
  force: number
  /** Multiplier on the entrance strength. */
  strength: number
  /** Rest-scale bias (swell grows, shrink dwindles). */
  scaleBias: number
  /** >1 spreads the letters' homes apart (letter-level bodies). */
  letterSpread: number
  /** Echo rings drawn behind the word (0..1). */
  echo: number
  /** The word outstays its line's exit by this long (s). */
  lingerSec: number
  /** Honors the line's `direction` (whip side, drift bias). */
  sided: boolean
}

const recipe = (over: Partial<GestureRecipe> & Pick<GestureRecipe, 'entrance' | 'hold'>): GestureRecipe => ({
  force: 1,
  strength: 1,
  scaleBias: 1,
  letterSpread: 1,
  echo: 0,
  lingerSec: 0,
  sided: false,
  ...over,
})

export const GESTURES: Record<GestureName, GestureRecipe> = {
  /** Drops from above and lands heavily. */
  fall: recipe({ entrance: 'fall', hold: 'rest', strength: 1.3 }),
  /** Floats up from below and keeps buoyant. */
  rise: recipe({ entrance: 'buoy', hold: 'bob', strength: 1.2 }),
  /** Slams in and stays twitchy. */
  strike: recipe({ entrance: 'slam', hold: 'jolt', strength: 1.3 }),
  /** Arrives in pieces that shudder. */
  break: recipe({ entrance: 'assemble', hold: 'tremble', force: 1.2 }),
  /** Loose and slow, barely held. */
  drift: recipe({ entrance: 'creep', hold: 'bob', force: 0.55, sided: true }),
  /** Tight shiver. */
  tremble: recipe({ entrance: 'creep', hold: 'tremble', force: 1.25 }),
  /** Grows past its rest size and breathes. */
  swell: recipe({ entrance: 'creep', hold: 'pulse', scaleBias: GESTURE_T.swellScale }),
  /** Dwindles below its rest size and goes still. */
  shrink: recipe({ entrance: 'creep', hold: 'still', scaleBias: GESTURE_T.shrinkScale }),
  /** Shoots in from a side at speed. */
  rush: recipe({ entrance: 'whip', hold: 'jolt', strength: 1.2, sided: true }),
  /** Shoots in and freezes dead. */
  halt: recipe({ entrance: 'whip', hold: 'still', sided: true }),
  /** The letters pull away from each other and stay apart. */
  apart: recipe({ entrance: 'creep', hold: 'still', letterSpread: GESTURE_T.apartSpread }),
  /** The letters fly in from everywhere and lock together. */
  together: recipe({ entrance: 'assemble', hold: 'still' }),
  /** Pulses with expanding ghost rings. */
  echo: recipe({ entrance: 'creep', hold: 'pulse', echo: GESTURE_T.echoStrength }),
  /** Hung from a pivot, swinging. */
  hang: recipe({ entrance: 'hang', hold: 'pendulum' }),
  /** Stays behind after its line leaves. */
  linger: recipe({ entrance: 'creep', hold: 'still', lingerSec: GESTURE_T.lingerSec }),
}

/** One gesture on one word, with where it came from. */
export interface GestureAssignment {
  /** Word index in the line. */
  index: number
  gesture: GestureName
  dir: DirectionWord | null
  source: 'direction' | 'lexicon'
}

// --- the lexicon -------------------------------------------------------------

/**
 * Fallback: word stems -> gestures, used only when a line has no
 * authored direction. Small on purpose; a miss means the word just
 * follows the section's base motion.
 */
export const LEXICON: Record<GestureName, string[]> = {
  fall: ['fall', 'fell', 'drop', 'down', 'sink'],
  rise: ['rise', 'rose', 'fly', 'lift', 'high'],
  strike: ['hit', 'strike', 'slam', 'bash'],
  break: ['break', 'broke', 'crack'],
  drift: ['drift', 'float', 'slow'],
  tremble: ['cold', 'shake', 'shiver', 'scared', 'sob'],
  swell: ['grow', 'loud', 'swell'],
  shrink: ['small', 'quiet', 'hush'],
  rush: ['run', 'fast', 'rush'],
  halt: ['stop', 'wait', 'halt'],
  apart: ['apart', 'gone', 'lost', 'leave', 'alone'],
  together: ['together', 'close', 'hold'],
  echo: ['echo', 'again'],
  hang: ['hang', 'swing'],
  linger: ['stay', 'linger', 'forever'],
}

const STEMS: [string, GestureName][] = Object.entries(LEXICON).flatMap(
  ([gesture, stems]) => stems.map((stem): [string, GestureName] => [stem, gesture as GestureName]),
)

/** Possible base forms of a word: itself, and de-suffixed variants
 * ("leavin'" -> leave, "sobbing" -> sob, "falls" -> fall). */
function baseForms(word: string): string[] {
  const bare = word.toLowerCase().replace(/[^a-z]/g, '')
  if (bare.length === 0) return []
  const out = new Set([bare])
  const addBase = (base: string) => {
    if (base.length < 2) return
    out.add(base)
    out.add(base + 'e')
    if (base.length >= 3 && base[base.length - 1] === base[base.length - 2]) {
      out.add(base.slice(0, -1))
    }
  }
  if (bare.endsWith('ing')) addBase(bare.slice(0, -3))
  else if (bare.endsWith('in')) addBase(bare.slice(0, -2))
  if (bare.endsWith('ed') || bare.endsWith('es')) addBase(bare.slice(0, -2))
  if (bare.endsWith('s')) out.add(bare.slice(0, -1))
  return [...out]
}

/** The gesture a single word's stem maps to, or null. */
export function lexiconGesture(word: string): GestureName | null {
  const forms = baseForms(word)
  if (forms.length === 0) return null
  for (const [stem, gesture] of STEMS) {
    for (const form of forms) {
      if (form === stem) return gesture
      if (stem.length >= 4 && form.startsWith(stem) && form.length - stem.length <= 2) {
        return gesture
      }
    }
  }
  return null
}

/** Lexicon pass over a line: at most `cap` matched words perform. */
export function lexiconGestures(
  words: readonly string[],
  cap = 2,
): GestureAssignment[] {
  const out: GestureAssignment[] = []
  for (let index = 0; index < words.length && out.length < cap; index++) {
    const gesture = lexiconGesture(words[index])
    if (gesture) out.push({ index, gesture, dir: null, source: 'lexicon' })
  }
  return out
}
