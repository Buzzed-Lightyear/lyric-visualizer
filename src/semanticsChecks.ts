/**
 * Around the LLM extraction: the automatic checks a generated semantics
 * file must pass before it is written, the neutral fallback when no API
 * key is available, and the diff report that compares a generated file
 * against an existing one. Pure module, shared by scripts and tests.
 */

import { refrainSources } from './choreo'
import type { LyricLine } from './lrc'
import {
  parseSemantics,
  validateFocusRanges,
  type Semantics,
  type SemanticLine,
} from './semantics'

const lineWordCount = (text: string) => text.split(/\s+/).filter(Boolean).length

/** Gesture share must stay in this band: sparse enough to mean something. */
export const GESTURE_SHARE = { min: 0.15, max: 0.4 }

/**
 * Checks beyond the schema, run on an already-parsed semantics document.
 * Returns one readable message per failure; empty means good to write.
 */
export function automaticChecks(
  semantics: Semantics,
  lrcLines: readonly LyricLine[],
  durationSec: number,
): string[] {
  const problems: string[] = []
  const sung = lrcLines.filter((line) => line.text.trim() !== '')

  // Coverage: sections span the sung part of the song, and every line
  // falls inside one.
  const first = semantics.sections[0]
  const last = semantics.sections[semantics.sections.length - 1]
  if (first && sung[0] && first.start > sung[0].time + 0.01) {
    problems.push(
      `sections start at ${first.start}s but the first line starts at ${sung[0].time}s`,
    )
  }
  if (last && last.end < durationSec - 5) {
    problems.push(`sections end at ${last.end}s but the song runs ${durationSec.toFixed(0)}s`)
  }
  for (const line of sung) {
    const inside = semantics.sections.some((s) => line.time >= s.start && line.time < s.end)
    if (!inside) {
      problems.push(`the line at ${line.time}s falls outside every section`)
      break // one example is enough
    }
  }

  // Focus indices against the real word counts.
  problems.push(
    ...validateFocusRanges(
      semantics,
      lrcLines.map((line) => ({ time: line.time, wordCount: lineWordCount(line.text) })),
    ),
  )

  // Gesture share: enough to matter, few enough to read as meaningful.
  const gestures = semantics.lines.filter((line) => line.gesture).length
  if (sung.length > 0) {
    const share = gestures / sung.length
    if (share < GESTURE_SHARE.min || share > GESTURE_SHARE.max) {
      problems.push(
        `${gestures} of ${sung.length} lines carry a gesture (${(share * 100).toFixed(0)}%); ` +
          `expected ${GESTURE_SHARE.min * 100}-${GESTURE_SHARE.max * 100}%`,
      )
    }
  }

  // Repeats share values: sections with the same label must be identical
  // apart from their times.
  const byLabel = new Map<string, string>()
  for (const section of semantics.sections) {
    const signature = JSON.stringify([section.energy, section.mood, section.palette, section.imagery])
    const seen = byLabel.get(section.label)
    if (seen === undefined) byLabel.set(section.label, signature)
    else if (seen !== signature) {
      problems.push(`sections labeled "${section.label}" disagree on energy/mood/palette/imagery`)
    }
  }

  // Refrains consistent: a repeat of an earlier line must not carry a
  // different gesture than its source (none is fine — the renderer copies
  // the source's choreography anyway).
  const sources = refrainSources(sung.map((line) => line.text))
  const annotationAt = (time: number): SemanticLine | undefined =>
    semantics.lines.find((line) => Math.abs(line.time - time) < 0.05)
  sources.forEach((sourceIndex, i) => {
    if (sourceIndex === null) return
    const repeat = annotationAt(sung[i].time)
    const source = annotationAt(sung[sourceIndex].time)
    if (repeat?.gesture && repeat.gesture !== source?.gesture) {
      problems.push(
        `the line at ${sung[i].time}s repeats the line at ${sung[sourceIndex].time}s but ` +
          `carries a different gesture ("${repeat.gesture}" vs "${source?.gesture ?? 'none'}")`,
      )
    }
  })

  return problems
}

// --- neutral fallback ----------------------------------------------------------

/** A gap this long between line starts opens a new section. */
const SECTION_GAP_SEC = 8

const NEUTRAL_PALETTE = ['#0a0c12', '#5a6b8f', '#9aa7bf']

/**
 * No API key: a semantics file that lets the song play with the neutral
 * look. Sections come from the gaps in the LRC (an instrumental pause or
 * an empty timed line opens a new one), every line gets default emphasis,
 * and no gestures are authored — the lexicon still fires at runtime.
 */
export function neutralSemantics(lrcLines: readonly LyricLine[], durationSec: number): unknown {
  const sung = lrcLines.filter((line) => line.text.trim() !== '')
  const boundaries: number[] = [0]
  for (let i = 1; i < sung.length; i++) {
    if (sung[i].time - sung[i - 1].time >= SECTION_GAP_SEC) boundaries.push(sung[i].time)
  }
  const end = Math.max(durationSec, sung[sung.length - 1]?.time ?? 0) || 1
  const sections = boundaries.map((start, i) => ({
    start,
    end: i + 1 < boundaries.length ? boundaries[i + 1] : end,
    label: `part ${i + 1}`,
    energy: 0.5,
    mood: 'neutral',
    palette: NEUTRAL_PALETTE,
    imagery: [],
  }))
  return {
    version: 2,
    sections,
    lines: sung.map((line) => ({ time: line.time, emphasis: 0.5 })),
  }
}

// --- diff report ----------------------------------------------------------------

/**
 * Compare a generated semantics document against the existing one, as
 * printable lines: section boundaries side by side, focus-word overlap,
 * gesture agreement.
 */
export function diffReport(existing: Semantics, generated: Semantics): string[] {
  const out: string[] = []

  out.push('sections:')
  const fmt = (s: { start: number; end: number; label: string; mood: string; energy: number }) =>
    `${s.start.toFixed(1).padStart(6)}-${s.end.toFixed(1).padEnd(6)} ${s.label} (${s.mood} ${s.energy})`
  const rows = Math.max(existing.sections.length, generated.sections.length)
  for (let i = 0; i < rows; i++) {
    const a = existing.sections[i]
    const b = generated.sections[i]
    out.push(
      `  ${a ? fmt(a).padEnd(44) : ''.padEnd(44)} | ${b ? fmt(b) : ''}`,
    )
  }
  const matched = generated.sections.filter((b) =>
    existing.sections.some((a) => Math.abs(a.start - b.start) <= 3),
  ).length
  out.push(
    `  boundaries within 3s of an existing one: ${matched} of ${generated.sections.length}`,
  )

  const byTime = new Map(existing.lines.map((line) => [line.time.toFixed(2), line]))
  const pair = (line: SemanticLine): SemanticLine | undefined => {
    const exact = byTime.get(line.time.toFixed(2))
    if (exact) return exact
    return existing.lines.find((a) => Math.abs(a.time - line.time) < 0.05)
  }

  let bothFocus = 0
  let focusAgree = 0
  for (const line of generated.lines) {
    const other = pair(line)
    if (!line.focus || !other?.focus) continue
    bothFocus++
    if (line.focus.some((f) => other.focus!.includes(f))) focusAgree++
  }
  out.push(
    `focus: ${bothFocus} lines annotated in both; ${focusAgree} share at least one focus word` +
      (bothFocus > 0 ? ` (${((focusAgree / bothFocus) * 100).toFixed(0)}%)` : ''),
  )

  let gestureBoth = 0
  let gestureSame = 0
  let onlyGenerated = 0
  let onlyExisting = 0
  for (const line of generated.lines) {
    const other = pair(line)
    if (line.gesture && other?.gesture) {
      gestureBoth++
      if (line.gesture === other.gesture) gestureSame++
    } else if (line.gesture) onlyGenerated++
    else if (other?.gesture) onlyExisting++
  }
  out.push(
    `gestures: ${gestureBoth} lines gestured in both (${gestureSame} same gesture); ` +
      `${onlyGenerated} only in the generated file, ${onlyExisting} only in the existing one`,
  )
  return out
}

/** Convenience for scripts: parse + checks in one call. */
export function validateGenerated(
  raw: unknown,
  lrcLines: readonly LyricLine[],
  durationSec: number,
): { semantics: Semantics | null; errors: string[] } {
  const { semantics, errors } = parseSemantics(raw)
  if (!semantics) return { semantics: null, errors }
  const problems = automaticChecks(semantics, lrcLines, durationSec)
  return problems.length > 0 ? { semantics: null, errors: problems } : { semantics, errors: [] }
}
