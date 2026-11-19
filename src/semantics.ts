/**
 * The semantic schema shared by extraction (hand-written in step 3, an LLM
 * in step 4) and the mapping layer. It carries no lyric text: lines are
 * identified by time, words by index.
 *
 * Version 2 adds optional per-line directions (focus word indices, a
 * gesture from the fixed list, a spatial direction). Version 1 files
 * still parse: every new field is optional.
 */

import { DIRECTION_WORDS, GESTURE_NAMES, type DirectionWord, type GestureName } from './gestures'

export interface SemanticSection {
  /** Seconds, inclusive. */
  start: number
  /** Seconds, exclusive. */
  end: number
  /** "verse 1", "chorus", ... Repeats of a section share the same values. */
  label: string
  /** 0..1 baseline intensity. */
  energy: number
  /** One short word; unknown moods fall back to neutral motion. */
  mood: string
  /** 3-5 hex colors; the first is the background. */
  palette: string[]
  /** Short tags; the first one that maps to a motif wins. */
  imagery: string[]
}

export interface SemanticLine {
  /** The line's LRC start time, in seconds. */
  time: number
  /** 0..1; how hard audio accents land during this line. */
  emphasis: number
  /** v2: 0-based indices of the one or two words that carry the line. */
  focus?: number[]
  /** v2: the gesture the focus words perform (needs `focus`). */
  gesture?: GestureName
  /** v2: spatial hint for sided gestures (needs `gesture`). */
  direction?: DirectionWord
}

export interface Semantics {
  sections: SemanticSection[]
  lines: SemanticLine[]
}

/** Lines not listed in the file get this emphasis. */
export const DEFAULT_EMPHASIS = 0.5

const HEX_COLOR = /^#[0-9a-f]{6}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isUnit(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1
}

/**
 * Validate a parsed JSON document. Returns the typed semantics, or null
 * plus one readable message per problem.
 */
export function parseSemantics(input: unknown): {
  semantics: Semantics | null
  errors: string[]
} {
  const errors: string[] = []
  if (!isRecord(input)) {
    return {
      semantics: null,
      errors: ['the root must be an object with "sections" and "lines"'],
    }
  }

  const sections: SemanticSection[] = []
  if (!Array.isArray(input.sections) || input.sections.length === 0) {
    errors.push('"sections" must be a non-empty array')
  } else {
    input.sections.forEach((raw: unknown, i: number) => {
      const label =
        isRecord(raw) && typeof raw.label === 'string' ? ` ("${raw.label}")` : ''
      const where = `sections[${i}]${label}`
      if (!isRecord(raw)) {
        errors.push(`${where} must be an object`)
        return
      }
      const before = errors.length
      if (!isTime(raw.start))
        errors.push(`${where}: "start" must be a number of seconds >= 0`)
      if (!isTime(raw.end)) {
        errors.push(`${where}: "end" must be a number of seconds >= 0`)
      } else if (isTime(raw.start) && raw.end <= raw.start) {
        errors.push(`${where}: "end" (${raw.end}) must be after "start" (${raw.start})`)
      }
      if (typeof raw.label !== 'string' || raw.label === '')
        errors.push(`${where}: "label" must be a non-empty string`)
      if (!isUnit(raw.energy))
        errors.push(`${where}: "energy" must be a number in 0..1, got ${JSON.stringify(raw.energy)}`)
      if (typeof raw.mood !== 'string' || raw.mood === '')
        errors.push(`${where}: "mood" must be one short word`)
      if (
        !Array.isArray(raw.palette) ||
        raw.palette.length < 3 ||
        raw.palette.length > 5 ||
        raw.palette.some((c: unknown) => typeof c !== 'string' || !HEX_COLOR.test(c))
      )
        errors.push(`${where}: "palette" must be 3-5 hex colors like "#0a0d1a" (first = background)`)
      if (!Array.isArray(raw.imagery) || raw.imagery.some((t: unknown) => typeof t !== 'string'))
        errors.push(`${where}: "imagery" must be an array of short string tags`)
      if (errors.length === before) sections.push(raw as unknown as SemanticSection)
    })
  }

  sections.sort((a, b) => a.start - b.start)
  for (let i = 1; i < sections.length; i++) {
    const prev = sections[i - 1]
    const next = sections[i]
    if (next.start < prev.end - 1e-6) {
      errors.push(
        `"${prev.label}" (${prev.start}-${prev.end}s) overlaps "${next.label}" (${next.start}-${next.end}s)`,
      )
    }
  }

  if (
    input.version !== undefined &&
    input.version !== 1 &&
    input.version !== 2
  ) {
    errors.push(`"version" must be 1 or 2, got ${JSON.stringify(input.version)}`)
  }

  const LINE_KEYS = new Set(['time', 'emphasis', 'focus', 'gesture', 'direction'])
  const lines: SemanticLine[] = []
  if (input.lines !== undefined) {
    if (!Array.isArray(input.lines)) {
      errors.push('"lines" must be an array of { time, emphasis, ... }')
    } else {
      input.lines.forEach((raw: unknown, i: number) => {
        if (!isRecord(raw) || !isTime(raw.time) || !isUnit(raw.emphasis)) {
          errors.push(
            `lines[${i}] must be { time: seconds >= 0, emphasis: 0..1 }, got ${JSON.stringify(raw)}`,
          )
          return
        }
        const where = `lines[${i}] (t=${raw.time})`
        const before = errors.length
        // The file must stay free of lyric text: only known fields, and
        // words are referred to by index.
        for (const key of Object.keys(raw)) {
          if (!LINE_KEYS.has(key)) {
            errors.push(`${where}: unknown field "${key}" (no lyric text in this file; words go by index)`)
          }
        }
        if (raw.focus !== undefined) {
          if (
            !Array.isArray(raw.focus) ||
            raw.focus.length < 1 ||
            raw.focus.length > 2 ||
            raw.focus.some((f: unknown) => !Number.isInteger(f) || (f as number) < 0) ||
            new Set(raw.focus).size !== raw.focus.length
          ) {
            errors.push(`${where}: "focus" must be 1-2 distinct word indices >= 0`)
          }
        }
        if (raw.gesture !== undefined) {
          if (typeof raw.gesture !== 'string' || !GESTURE_NAMES.includes(raw.gesture as GestureName)) {
            errors.push(`${where}: "gesture" must be one of ${GESTURE_NAMES.join(', ')}`)
          } else if (raw.focus === undefined) {
            errors.push(`${where}: "gesture" needs "focus" (the words that perform it)`)
          }
        }
        if (raw.direction !== undefined) {
          if (
            typeof raw.direction !== 'string' ||
            !DIRECTION_WORDS.includes(raw.direction as DirectionWord)
          ) {
            errors.push(`${where}: "direction" must be one of ${DIRECTION_WORDS.join(', ')}`)
          } else if (raw.gesture === undefined) {
            errors.push(`${where}: "direction" needs a "gesture" to apply to`)
          }
        }
        if (errors.length === before) {
          lines.push({
            time: raw.time,
            emphasis: raw.emphasis,
            ...(raw.focus !== undefined ? { focus: raw.focus as number[] } : {}),
            ...(raw.gesture !== undefined ? { gesture: raw.gesture as GestureName } : {}),
            ...(raw.direction !== undefined ? { direction: raw.direction as DirectionWord } : {}),
          })
        }
      })
    }
  }
  lines.sort((a, b) => a.time - b.time)

  return errors.length > 0
    ? { semantics: null, errors }
    : { semantics: { sections, lines }, errors }
}

/** Index of the section containing `time`, or -1 between/outside sections. */
export function activeSectionIndex(sections: SemanticSection[], time: number): number {
  let low = 0
  let high = sections.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (sections[mid].start <= time) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found >= 0 && time < sections[found].end ? found : -1
}

/** The full semantic annotation for the line starting at `lineTime`. */
export function lineAnnotation(
  semantics: Semantics,
  lineTime: number | null,
): SemanticLine | null {
  if (lineTime === null) return null
  for (const line of semantics.lines) {
    if (Math.abs(line.time - lineTime) < 0.05) return line
    if (line.time > lineTime) break
  }
  return null
}

/** Emphasis for the lyric line starting at `lineTime`, if listed. */
export function emphasisAt(semantics: Semantics, lineTime: number | null): number {
  return lineAnnotation(semantics, lineTime)?.emphasis ?? DEFAULT_EMPHASIS
}

/**
 * Check every focus index against the real word counts (the counts come
 * from the loaded lyrics at runtime; made-up lines in tests). Returns
 * one readable message per out-of-range index or unmatched line.
 */
export function validateFocusRanges(
  semantics: Semantics,
  lines: readonly { time: number; wordCount: number }[],
): string[] {
  const errors: string[] = []
  for (const sem of semantics.lines) {
    if (!sem.focus) continue
    const match = lines.find((line) => Math.abs(line.time - sem.time) < 0.05)
    if (!match) {
      errors.push(`line at ${sem.time}s has "focus" but no lyric line starts there`)
      continue
    }
    for (const index of sem.focus) {
      if (index >= match.wordCount) {
        errors.push(
          `line at ${sem.time}s: focus index ${index} out of range (the line has ${match.wordCount} words)`,
        )
      }
    }
  }
  return errors
}
