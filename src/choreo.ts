/**
 * Per-line choreography: ties the section grammar, the semantics file's
 * directions, the lexicon fallback and refrain detection together. Pure
 * over the loaded lyric lines (which never enter the repo) and the
 * committed semantics (which carries no text).
 *
 * Rules:
 * - Every line follows its section's base motion (one grammar per
 *   section).
 * - A line whose words repeat an earlier line reuses that line's
 *   choreography exactly, wherever it sits in the song.
 * - A line with an authored direction puts its gesture on its focus
 *   words; a line without one falls back to the word-stem lexicon.
 */

import { lexiconGestures, type GestureAssignment } from './gestures'
import { sectionGrammar, type SectionGrammar } from './mapping'
import {
  activeSectionIndex,
  lineAnnotation,
  type Semantics,
} from './semantics'

export interface LineChoreo {
  grammar: SectionGrammar
  focus: number[]
  gestures: GestureAssignment[]
  /** Index of the earlier line this one repeats, or null. */
  refrainOf: number | null
}

/** Split a lyric line into words the way the layouts do. */
export function lineWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9']/g, '')
}

/**
 * Word equality with a cut-off rule: a word ending in "-" (a line cut
 * short) matches any word it starts ("underst-" vs "understand").
 */
function wordMatches(a: string, b: string): boolean {
  const na = normalizeWord(a)
  const nb = normalizeWord(b)
  if (na.length === 0 || nb.length === 0) return false
  if (a.endsWith('-') && na.length >= 2 && nb.startsWith(na)) return true
  if (b.endsWith('-') && nb.length >= 2 && na.startsWith(nb)) return true
  return na === nb
}

/** At least 3 words, at least 70% of the longer line, matching in order. */
const REFRAIN_MIN_WORDS = 3
const REFRAIN_MIN_FRAC = 0.7

function isRefrain(a: readonly string[], b: readonly string[]): boolean {
  const m = Math.min(a.length, b.length)
  if (m < REFRAIN_MIN_WORDS) return false
  if (m / Math.max(a.length, b.length) < REFRAIN_MIN_FRAC) return false
  for (let i = 0; i < m; i++) {
    if (!wordMatches(a[i], b[i])) return false
  }
  return true
}

/**
 * For each line, the index of the earliest earlier line whose words it
 * repeats, or null. Chains collapse to the first occurrence.
 */
export function refrainSources(texts: readonly string[]): (number | null)[] {
  const words = texts.map(lineWords)
  return texts.map((_, i) => {
    for (let j = 0; j < i; j++) {
      if (isRefrain(words[j], words[i])) return j
    }
    return null
  })
}

/**
 * Build the full choreography for every line. Out-of-range focus
 * indices are dropped here (validateFocusRanges reports them).
 */
export function buildChoreo(
  lines: readonly { time: number; text: string }[],
  semantics: Semantics | null,
): LineChoreo[] {
  const refrains = refrainSources(lines.map((line) => line.text))
  const out: LineChoreo[] = []
  lines.forEach((line, i) => {
    const source = refrains[i]
    if (source !== null) {
      out.push({ ...out[source], refrainOf: source })
      return
    }
    const sections = semantics?.sections ?? []
    const index = activeSectionIndex(sections, line.time)
    const section = index >= 0 ? sections[index] : null
    const words = lineWords(line.text)
    const annotation = semantics ? lineAnnotation(semantics, line.time) : null
    const focus = (annotation?.focus ?? []).filter((f) => f < words.length)
    const gestures: GestureAssignment[] =
      annotation?.gesture && focus.length > 0
        ? focus.map((index) => ({
            index,
            gesture: annotation.gesture!,
            dir: annotation.direction ?? null,
            source: 'direction' as const,
          }))
        : lexiconGestures(words)
    out.push({
      grammar: sectionGrammar(section, semantics?.look ?? null),
      focus,
      gestures,
      refrainOf: null,
    })
  })
  return out
}
