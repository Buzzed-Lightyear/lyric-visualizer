/**
 * The semantic schema shared by extraction (hand-written in step 3, an LLM
 * in step 4) and the mapping layer. It carries no lyric text: lines are
 * identified by time, words by index.
 *
 * Version 2 adds optional per-line directions (focus word indices, a
 * gesture from the fixed list, a spatial direction). Version 1 files
 * still parse: every new field is optional.
 *
 * Version 3 gives each song its own look. Mood and imagery are free
 * text; each section carries its four axes as numbers, a one-line scene
 * and which of the song's two type voices it uses; and a song-level
 * `look` holds a description in the model's own words, a palette, the
 * two voices and the chosen background preset per section label.
 * Version 1 and 2 files parse exactly as before and render exactly as
 * before: the version 3 fields are dropped from them, never guessed.
 */

import { AXIS_NAMES, isAxes, type MoodAxes } from './axes'
import { DIRECTION_WORDS, GESTURE_NAMES, type DirectionWord, type GestureName } from './gestures'
import { isVoiceName, VOICE_NAME_LIST, type VoiceName } from './voiceNames'

/** Which of the song's two voices a section is set in. */
export type SectionVoice = 'main' | 'accent'

export interface SemanticSection {
  /** Seconds, inclusive. */
  start: number
  /** Seconds, exclusive. */
  end: number
  /** "verse 1", "chorus", ... Repeats of a section share the same values. */
  label: string
  /** 0..1 baseline intensity. */
  energy: number
  /**
   * Version 3: free mood words. Before: one short word; the ten known
   * words sit on anchors (src/axes.ts), anything else is neutral.
   */
  mood: string
  /** 3-5 hex colors; the first is the background. */
  palette: string[]
  /** Short tags; free text from version 3. */
  imagery: string[]
  /** v3: where the section sits on the four axes. Drives motion and type. */
  axes?: MoodAxes
  /** v3: one line describing the scene, in the model's own words. */
  scene?: string
  /** v3: which of the look's two voices this section is set in. */
  voice?: SectionVoice
}

/** v3: the song-level look. */
export interface SongLook {
  /** 1-3 sentences in the model's own words. Never lyric text. */
  description: string
  /** The song's palette; section palettes vary within it. */
  palette: string[]
  /** Two of the eight type voices. */
  voices: { main: VoiceName; accent: VoiceName }
  /** The chosen background preset per section label. */
  presets: Record<string, string>
  /** Who chose `presets`: the model, or the scorer after the model failed. */
  presetsFrom?: 'model' | 'scorer'
  /** Who wrote the look. */
  source?: 'api' | 'agent'
  /**
   * True when only the look was added to an older file: the sections
   * are still version 2 shaped (no axes, scene or voice of their own).
   */
  partial?: boolean
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
  /** Present on version 3 files only. */
  look?: SongLook
}

/**
 * Size limits on the free-text fields of version 3. The file must never
 * carry lyric text; short fields leave no room for it. (Generation also
 * compares these fields against the lyrics: src/lookGen.ts.)
 */
export const LOOK_LIMITS = {
  description: 400,
  scene: 160,
  mood: 48,
  imageryTag: 32,
  imageryTags: 6,
  lookPalette: 6,
} as const

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

  const versionOk =
    input.version === undefined || input.version === 1 || input.version === 2 || input.version === 3
  if (!versionOk) {
    errors.push(`"version" must be 1, 2 or 3, got ${JSON.stringify(input.version)}`)
  }
  const v3 = input.version === 3
  /** A look added to an older file: its sections may still be version 2 shaped. */
  const partial = v3 && isRecord(input.look) && input.look.partial === true

  const SECTION_KEYS = new Set([
    'start', 'end', 'label', 'energy', 'mood', 'palette', 'imagery', 'axes', 'scene', 'voice',
  ])
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
      if (typeof raw.mood !== 'string' || raw.mood === '') {
        errors.push(`${where}: "mood" must be ${v3 ? 'a few mood words' : 'one short word'}`)
      } else if (v3 && raw.mood.length > LOOK_LIMITS.mood) {
        errors.push(`${where}: "mood" must be at most ${LOOK_LIMITS.mood} characters`)
      }
      if (
        !Array.isArray(raw.palette) ||
        raw.palette.length < 3 ||
        raw.palette.length > 5 ||
        raw.palette.some((c: unknown) => typeof c !== 'string' || !HEX_COLOR.test(c))
      )
        errors.push(`${where}: "palette" must be 3-5 hex colors like "#0a0d1a" (first = background)`)
      if (!Array.isArray(raw.imagery) || raw.imagery.some((t: unknown) => typeof t !== 'string')) {
        errors.push(`${where}: "imagery" must be an array of short string tags`)
      } else if (
        v3 &&
        (raw.imagery.length > LOOK_LIMITS.imageryTags ||
          raw.imagery.some((t: string) => t === '' || t.length > LOOK_LIMITS.imageryTag))
      ) {
        errors.push(
          `${where}: "imagery" takes at most ${LOOK_LIMITS.imageryTags} tags of 1-${LOOK_LIMITS.imageryTag} characters`,
        )
      }
      if (v3) {
        // Free text lives in named fields only; nothing else may ride along.
        for (const key of Object.keys(raw)) {
          if (!SECTION_KEYS.has(key)) errors.push(`${where}: unknown field "${key}"`)
        }
        if (raw.axes === undefined ? !partial : !isAxes(raw.axes)) {
          errors.push(`${where}: "axes" must be { ${AXIS_NAMES.join(', ')} }, each 0..1`)
        }
        if (raw.scene === undefined ? !partial : typeof raw.scene !== 'string' || raw.scene === '') {
          errors.push(`${where}: "scene" must be one line describing the scene`)
        } else if (typeof raw.scene === 'string' && raw.scene.length > LOOK_LIMITS.scene) {
          errors.push(`${where}: "scene" must be at most ${LOOK_LIMITS.scene} characters`)
        }
        if (raw.voice === undefined ? !partial : raw.voice !== 'main' && raw.voice !== 'accent') {
          errors.push(`${where}: "voice" must be "main" or "accent"`)
        }
      }
      if (errors.length === before) {
        // Built field by field: version 1 and 2 sections never carry the
        // version 3 fields, whatever the file holds.
        const section: SemanticSection = {
          start: raw.start as number,
          end: raw.end as number,
          label: raw.label as string,
          energy: raw.energy as number,
          mood: raw.mood as string,
          palette: raw.palette as string[],
          imagery: raw.imagery as string[],
        }
        if (v3 && raw.axes !== undefined) {
          const axes = raw.axes as MoodAxes
          section.axes = {
            arousal: axes.arousal,
            valence: axes.valence,
            tension: axes.tension,
            warmth: axes.warmth,
          }
        }
        if (v3 && raw.scene !== undefined) section.scene = raw.scene as string
        if (v3 && raw.voice !== undefined) section.voice = raw.voice as SectionVoice
        sections.push(section)
      }
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

  const look = parseLook(input, v3, sections, errors)

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
    : { semantics: look ? { sections, lines, look } : { sections, lines }, errors }
}

const LOOK_KEYS = new Set([
  'description', 'palette', 'voices', 'presets', 'presetsFrom', 'source', 'partial',
])

/** Validate the song-level look; pushes readable errors, returns the typed look. */
function parseLook(
  input: Record<string, unknown>,
  v3: boolean,
  sections: readonly SemanticSection[],
  errors: string[],
): SongLook | null {
  const raw = input.look
  if (!v3) {
    if (raw !== undefined) errors.push('"look" needs "version": 3')
    return null
  }
  if (!isRecord(raw)) {
    errors.push('version 3 needs a "look": { description, palette, voices, presets }')
    return null
  }
  const before = errors.length
  for (const key of Object.keys(raw)) {
    if (!LOOK_KEYS.has(key)) errors.push(`look: unknown field "${key}"`)
  }
  if (typeof raw.description !== 'string' || raw.description.trim() === '') {
    errors.push('look: "description" must be 1-3 sentences')
  } else if (raw.description.length > LOOK_LIMITS.description) {
    errors.push(`look: "description" must be at most ${LOOK_LIMITS.description} characters`)
  }
  if (
    !Array.isArray(raw.palette) ||
    raw.palette.length < 3 ||
    raw.palette.length > LOOK_LIMITS.lookPalette ||
    raw.palette.some((c: unknown) => typeof c !== 'string' || !HEX_COLOR.test(c))
  ) {
    errors.push(`look: "palette" must be 3-${LOOK_LIMITS.lookPalette} hex colors like "#0a0d1a"`)
  }
  const voices = raw.voices
  if (!isRecord(voices) || !isVoiceName(voices.main) || !isVoiceName(voices.accent)) {
    errors.push(`look: "voices" must be { main, accent }, each one of ${VOICE_NAME_LIST.join(', ')}`)
  } else if (voices.main === voices.accent) {
    errors.push('look: "voices" main and accent must be two different voices')
  }
  const presets: Record<string, string> = {}
  if (raw.presets !== undefined) {
    if (!isRecord(raw.presets)) {
      errors.push('look: "presets" must map section labels to preset names')
    } else {
      const labels = new Set(sections.map((section) => section.label))
      for (const [label, name] of Object.entries(raw.presets)) {
        if (typeof name !== 'string' || name === '') {
          errors.push(`look: preset for "${label}" must be a preset name`)
        } else if (sections.length > 0 && !labels.has(label)) {
          errors.push(`look: "presets" names "${label}", which is not a section label`)
        } else {
          presets[label] = name
        }
      }
    }
  }
  if (raw.presetsFrom !== undefined && raw.presetsFrom !== 'model' && raw.presetsFrom !== 'scorer') {
    errors.push('look: "presetsFrom" must be "model" or "scorer"')
  }
  if (raw.source !== undefined && raw.source !== 'api' && raw.source !== 'agent') {
    errors.push('look: "source" must be "api" or "agent"')
  }
  if (raw.partial !== undefined && typeof raw.partial !== 'boolean') {
    errors.push('look: "partial" must be true or false')
  }
  if (errors.length > before) return null
  const v = voices as { main: VoiceName; accent: VoiceName }
  return {
    description: raw.description as string,
    palette: raw.palette as string[],
    voices: { main: v.main, accent: v.accent },
    presets,
    ...(raw.presetsFrom !== undefined ? { presetsFrom: raw.presetsFrom as 'model' | 'scorer' } : {}),
    ...(raw.source !== undefined ? { source: raw.source as 'api' | 'agent' } : {}),
    ...(raw.partial === true ? { partial: true } : {}),
  }
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
