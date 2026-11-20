/**
 * The model chooses the scenes. After a song's look is written
 * (src/semanticsGen.ts), the model is shown the song's look and sections,
 * every preset that may play (name, description, axes, imagery, colors)
 * and the looks and preset sets of the songs already in the library, and
 * chooses one preset per section label as one cohesive set for this song.
 *
 * Nothing here scores, weights or spreads presets: whether two songs end
 * up looking different is the model's call, made from reading the song.
 * Code keeps guardrails only (presetSetProblems in src/presetPick.ts):
 * names must exist; nothing banned, broken, blank or hard-strobing; no
 * preset for two different labels. Invalid answers are retried with the
 * problems quoted back; if the last one is still invalid the scorer picks
 * instead, and the file records that (look.presetsFrom: "scorer").
 *
 * Also here: the look-only prompt, for giving an older file a look from
 * its existing sections without the lyrics (marked partial).
 *
 * Pure module; the model is an injected `ask` (see semanticsGen.ts).
 */

import { z } from 'zod'
import { sectionAxes } from './axes'
import {
  CATALOG,
  pickForSections,
  presetSetProblems,
  usablePresetNames,
  type CatalogEntry,
  type Feedback,
} from './presetPick'
import { LOOK_LIMITS, parseSemantics, type SemanticSection, type SongLook } from './semantics'
import {
  askUntilValid,
  AXES_GUIDE,
  LookDraftSchema,
  VOICES_GUIDE,
  type Ask,
  type LookDraft,
} from './semanticsGen'

/** A song already in the library, as the model is shown it. */
export interface LibraryLook {
  title: string
  artist: string
  /** Its look description; null for a song that has no look yet. */
  description: string | null
  /** The presets it plays, by section label. */
  presets: Record<string, string>
}

export interface PresetChoiceInput {
  title: string
  artist: string
  look: LookDraft
  /** Every section, in the order the song plays them. */
  sections: readonly SemanticSection[]
  /** Global bans, and the owner's saved choices for this song. */
  feedback: Feedback
  /** The other songs in the library. */
  library: readonly LibraryLook[]
}

export const PresetChoiceSchema = z.object({
  presets: z.array(z.object({ label: z.string(), preset: z.string() })),
})

export type PresetChoice = z.infer<typeof PresetChoiceSchema>

const hex = (rgb: readonly number[]) =>
  '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

const round2 = (value: number) => Number(value.toFixed(2))

/** One preset as the model sees it: the fields named in the README, nothing else. */
export function presetLine(name: string, entry: CatalogEntry): string {
  return JSON.stringify({
    name,
    description: entry.description,
    axes: [entry.axes.arousal, entry.axes.valence, entry.axes.tension, entry.axes.warmth].map(round2),
    imagery: entry.imagery,
    colors: entry.colors.map(hex),
  })
}

/** The first section of each label, in order of first appearance. */
export function sectionsByLabel(sections: readonly SemanticSection[]): SemanticSection[] {
  const seen = new Set<string>()
  return sections.filter((section) => {
    if (seen.has(section.label)) return false
    seen.add(section.label)
    return true
  })
}

function sectionLine(section: SemanticSection): string {
  const axes = sectionAxes(section)
  const parts = [
    `energy ${round2(section.energy)}`,
    `mood "${section.mood}"`,
    `axes [${[axes.arousal, axes.valence, axes.tension, axes.warmth].map(round2).join(', ')}]`,
    `palette ${section.palette.join(' ')}`,
    `imagery ${section.imagery.length > 0 ? section.imagery.join(', ') : '(none)'}`,
  ]
  if (section.scene !== undefined) parts.push(`scene: ${section.scene}`)
  return `- "${section.label}": ${parts.join('; ')}`
}

export function buildPresetPrompt(
  input: PresetChoiceInput,
  catalog: Record<string, CatalogEntry> = CATALOG,
): string {
  const labels = sectionsByLabel(input.sections)
  const order = input.sections.map((section) => section.label).join(' -> ')
  const names = usablePresetNames(input.feedback, catalog)
  const presets = names.map((name) => presetLine(name, catalog[name])).join('\n')

  const saved = Object.entries(input.feedback.chosen).filter(([label]) =>
    labels.some((section) => section.label === label),
  )
  const savedBlock =
    saved.length === 0
      ? ''
      : `\nThe owner has already fixed these by hand. They play whatever you choose, so \
build the rest of the set around them (still return a preset for every label):\n` +
        saved.map(([label, name]) => `- "${label}": ${name}`).join('\n') +
        '\n'

  const library =
    input.library.length === 0
      ? 'None yet: this is the first song.'
      : input.library
          .map((song) => {
            const used = [...new Set(Object.values(song.presets))]
            return (
              `- "${song.title}" by ${song.artist}\n` +
              `  look: ${song.description ?? '(none written yet)'}\n` +
              `  presets: ${used.length > 0 ? used.map((name) => JSON.stringify(name)).join(', ') : '(none)'}`
            )
          })
          .join('\n')

  return `You are choosing the moving backgrounds for one song in a music visualizer. \
Each section of the song plays over one background preset (a MilkDrop-style abstract \
animation); the lyrics are set as kinetic type on top.

Song: "${input.title}" by ${input.artist}.

Its look, already written:
${input.look.description}
Song palette: ${input.look.palette.join(' ')}
Type voices: main ${input.look.voices.main}, accent ${input.look.voices.accent}

Its sections play in this order:
${order}

One entry per section label:
${labels.map(sectionLine).join('\n')}

The four axes, all 0..1, listed as [arousal, valence, tension, warmth]:
${AXES_GUIDE}
${savedBlock}
THE PRESETS
Each line below is one preset you may use: its name, one sentence saying what it \
looks like, its axes on the same scale as the sections, its imagery tags and its \
dominant colors. The name is only an ID — judge a preset by its description, axes, \
imagery and colors, and copy the name exactly, character for character.

${presets}

SONGS ALREADY IN THE LIBRARY
The library is meant to be a set of songs that each look like themselves. These \
are the songs already in it, with their looks and the presets they play:
${library}

WHAT TO CHOOSE
One preset per section label (${labels.map((section) => `"${section.label}"`).join(', ')}), chosen \
together as ONE cohesive set: a single visual world that is this song's look, in \
which each section's preset fits that section's mood, energy and scene, and the \
changes from section to section follow the song's structure. Give this song its \
own identity next to the songs above — a set that could only be this song's.
- Every label gets exactly one preset.
- No preset is used for two different labels.
- Use only names from the list above, copied exactly.`
}

/** The model's list as a label -> preset map, plus shape problems. */
export function presetChoiceMap(choice: PresetChoice): {
  presets: Record<string, string>
  errors: string[]
} {
  const presets: Record<string, string> = {}
  const errors: string[] = []
  for (const { label, preset } of choice.presets) {
    if (Object.hasOwn(presets, label)) errors.push(`"${label}" is listed twice; one preset per label`)
    else presets[label] = preset
  }
  return { presets, errors }
}

/** The scorer's own picks, one per label: the fallback set. */
export function scorerPresets(
  sections: readonly SemanticSection[],
  feedback: Feedback,
  catalog: Record<string, CatalogEntry> = CATALOG,
): Record<string, string> {
  const picks = pickForSections([...sections], { chosen: {}, banned: feedback.banned }, catalog)
  const presets: Record<string, string> = {}
  for (const pick of picks.values()) {
    if (pick.chosen) presets[pick.label] = pick.chosen
  }
  return presets
}

export interface PresetChoiceResult {
  presets: Record<string, string>
  /** "scorer" when the model's answers never passed the guardrails. */
  from: 'model' | 'scorer'
  /** Why the scorer had to step in; empty when the model's set was used. */
  problems: string[]
}

/**
 * Ask the model for the song's preset set and hold it to the guardrails.
 * Invalid answers are retried; after the last one — or if the call
 * itself fails — the scorer picks and the result says so.
 */
export async function choosePresets(
  input: PresetChoiceInput,
  ask: Ask,
  log: (message: string) => void = () => {},
  catalog: Record<string, CatalogEntry> = CATALOG,
): Promise<PresetChoiceResult> {
  const labels = sectionsByLabel(input.sections).map((section) => section.label)
  let problems: string[]
  try {
    const result = await askUntilValid(
      buildPresetPrompt(input, catalog),
      PresetChoiceSchema,
      ask,
      (choice) => {
        const { presets, errors } = presetChoiceMap(choice)
        const all = [...errors, ...presetSetProblems(presets, labels, input.feedback, catalog)]
        return all.length > 0 ? { value: null, errors: all } : { value: presets, errors: [] }
      },
      log,
      'preset set',
    )
    if (result.value) return { presets: result.value, from: 'model', problems: [] }
    problems = result.errors
  } catch (error) {
    problems = [`the model call failed: ${error instanceof Error ? error.message : String(error)}`]
  }
  log('  no valid preset set from the model; falling back to the scorer')
  return { presets: scorerPresets(input.sections, input.feedback, catalog), from: 'scorer', problems }
}

/** A library song as the model is shown it: its look and the presets it plays. */
export function libraryLook(
  meta: { title: string; artist: string },
  sections: readonly SemanticSection[],
  look: SongLook | null,
  feedback: Feedback,
  catalog: Record<string, CatalogEntry> = CATALOG,
): LibraryLook {
  const presets: Record<string, string> = {}
  for (const pick of pickForSections([...sections], feedback, catalog, look).values()) {
    if (pick.chosen) presets[pick.label] = pick.chosen
  }
  return { title: meta.title, artist: meta.artist, description: look?.description ?? null, presets }
}

// --- look only (no lyrics) -----------------------------------------------------

export interface LookOnlyInput {
  title: string
  artist: string
  durationSec: number
  sections: readonly SemanticSection[]
}

/**
 * The prompt for giving an already-annotated song a look without its
 * lyrics: the model sees the title, the artist and the sections as they
 * are, and writes only the description, the palette and the two voices.
 * The result is marked partial — the sections keep their old shape.
 */
export function buildLookOnlyPrompt(input: LookOnlyInput): string {
  const sections = input.sections
    .map(
      (section) =>
        `- ${section.start.toFixed(1)}-${section.end.toFixed(1)}s "${section.label}": ` +
        `energy ${round2(section.energy)}; mood "${section.mood}"; palette ${section.palette.join(' ')}; ` +
        `imagery ${section.imagery.length > 0 ? section.imagery.join(', ') : '(none)'}`,
    )
    .join('\n')

  return `You are giving a song its look for a music visualizer: a moving abstract \
background with the lyrics set as kinetic type on top.

Song: "${input.title}" by ${input.artist}, ${Math.round(input.durationSec)} seconds.

The lyrics are not available here. The song's sections were annotated earlier and \
stay as they are:
${sections}

From the title, the artist and these sections, write the song's look. Every song in \
the library should be recognizable at a glance as itself. There is no house style \
and no list to choose from: the look comes from your reading of this song.
- description: 1-3 sentences (at most ${LOOK_LIMITS.description} characters), in your own words, saying \
how this song should look and move on screen and what sets it apart from any other \
song. Describe; never quote lyrics.
- palette: 4-${LOOK_LIMITS.lookPalette} hex colors like "#0a0d1a" for the whole song, true to the section \
palettes above. The first is the darkest and is the background.
- voices: the song's two typefaces, "main" and "accent", two DIFFERENT names from \
these eight (the only fixed list here — they are the fonts that exist):
${VOICES_GUIDE}
  main sets the song. accent is its counterpart: the lines that hit hardest \
(emphasis 0.85 or above) switch to it.`
}

/** Ask for a look-only draft and validate it with the app's own parser. */
export async function writeLookOnly(
  input: LookOnlyInput,
  ask: Ask,
  log: (message: string) => void = () => {},
): Promise<{ look: LookDraft | null; errors: string[] }> {
  const result = await askUntilValid(
    buildLookOnlyPrompt(input),
    LookDraftSchema,
    ask,
    (draft) => {
      const errors = lookDraftProblems(draft, input.sections)
      return errors.length > 0 ? { value: null, errors } : { value: draft, errors: [] }
    },
    log,
    'look',
  )
  return { look: result.value, errors: result.errors }
}

/** The parser's verdict on a look draft placed over the given sections. */
export function lookDraftProblems(draft: LookDraft, sections: readonly SemanticSection[]): string[] {
  return parseSemantics({
    version: 3,
    look: { ...draft, presets: {}, partial: true },
    sections,
    lines: [],
  }).errors
}

/**
 * Put a look on an existing semantics document (parsed JSON), leaving
 * its sections and lines untouched. The result is version 3.
 */
export function withLook(doc: unknown, look: SongLook): unknown {
  const raw = (typeof doc === 'object' && doc !== null ? doc : {}) as Record<string, unknown>
  return { version: 3, look, sections: raw.sections, lines: raw.lines ?? [] }
}
