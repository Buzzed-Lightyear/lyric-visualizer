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
 * Then the model sees pixels. Descriptions are one line each and miss;
 * so, when the preset strips are on disk, the model is shown the strip
 * of every preset it chose and marks the ones that contradict the look.
 * For each misfit it names alternatives, is shown their strips, and
 * picks a replacement — or keeps the original if nothing is better. The
 * same guardrails hold, and the look records whether the review ran.
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
  type PromptPart,
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

/**
 * One preset as the model sees it: what it looks like, plus two measured
 * numbers for its judgment — how readable white text is over it (0..1)
 * and what it costs to draw (ms per frame). Information, not rules: no
 * code compares or thresholds them.
 */
export function presetLine(name: string, entry: CatalogEntry): string {
  return JSON.stringify({
    name,
    description: entry.description,
    axes: [entry.axes.arousal, entry.axes.valence, entry.axes.tension, entry.axes.warmth].map(round2),
    imagery: entry.imagery,
    colors: entry.colors.map(hex),
    readability: round2(entry.readability),
    drawMs: round2(entry.costMs),
  })
}

/** What the two measured numbers mean, for the prompts that show them. */
function measuredGuide(catalog: Record<string, CatalogEntry>): string {
  const costs = Object.values(catalog)
    .map((entry) => entry.costMs)
    .filter((cost) => cost > 0)
    .sort((a, b) => a - b)
  const median = costs.length > 0 ? costs[Math.floor(costs.length / 2)] : 0
  return (
    `"readability" is measured: how readable plain white text is over the preset, 0 (lost) to 1 ` +
    `(clear). The renderer adapts the text to whatever is behind it, so a low number is not a ban; ` +
    `it tells you how hard the preset is on the lyrics. "drawMs" is the measured cost of one frame ` +
    `in milliseconds (the median preset costs ${round2(median)}); a very costly preset can stutter. ` +
    `Weigh both as you see fit.`
  )
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
looks like, its axes on the same scale as the sections, its imagery tags, its \
dominant colors, and two measured numbers. The name is only an ID — judge a preset \
by its description, axes, imagery and colors, and copy the name exactly, character \
for character.
${measuredGuide(catalog)}

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

// --- the model sees pixels -----------------------------------------------------

/** A preset's strip as a base64 PNG, or null when it is not on disk. */
export type StripSource = (presetName: string) => string | null

export interface ReviewInput {
  title: string
  artist: string
  look: LookDraft
  sections: readonly SemanticSection[]
  /** The set chosen from text: section label -> preset. */
  presets: Readonly<Record<string, string>>
  feedback: Feedback
}

/** How many alternatives the model may name, and be shown, per misfit. */
export const SHORTLIST_MAX = 6

export const ReviewVerdictSchema = z.object({
  verdicts: z.array(
    z.object({
      label: z.string(),
      fits: z.boolean(),
      reason: z.string(),
      alternatives: z.array(z.string()),
    }),
  ),
})

export const ReviewSwapSchema = z.object({
  choices: z.array(z.object({ label: z.string(), preset: z.string(), reason: z.string() })),
})

export interface Misfit {
  label: string
  original: string
  reason: string
  /** Usable alternatives with a strip on disk, none used elsewhere in the set. */
  shortlist: string[]
}

export interface ReviewResult {
  /** False when the review could not run (no strips, or the call failed). */
  ran: boolean
  /** Why it did not run. */
  skipped?: string
  /** The set after the review. */
  presets: Record<string, string>
  swaps: { label: string; from: string; to: string; reason: string }[]
  /** Misfits whose original was kept: nothing shown was better. */
  kept: { label: string; preset: string; reason: string }[]
}

const STRIP_NOTE =
  'Every image is one preset on the same test track, four frames left to right: ' +
  'a QUIET moment, a LOUD moment, ON A BEAT, and LATER in the track.'

const text = (value: string): PromptPart => ({ type: 'text', text: value })
const image = (data: string): PromptPart => ({ type: 'image', mediaType: 'image/png', data })

function lookBlock(input: ReviewInput): string {
  return (
    `Song: "${input.title}" by ${input.artist}.\n\n` +
    `Its look:\n${input.look.description}\n` +
    `Song palette: ${input.look.palette.join(' ')}\n` +
    `Type voices: main ${input.look.voices.main}, accent ${input.look.voices.accent}`
  )
}

/** Stage one: the strips of the chosen presets; which contradict the look? */
export function buildReviewPrompt(
  input: ReviewInput,
  strips: StripSource,
  catalog: Record<string, CatalogEntry> = CATALOG,
): PromptPart[] {
  const labels = sectionsByLabel(input.sections)
  const parts: PromptPart[] = [
    text(
      `You chose the background presets for one song in a music visualizer from one-line ` +
        `descriptions. Now you can see them. ${STRIP_NOTE}\n\n${lookBlock(input)}\n\n` +
        `Its sections play in this order:\n${input.sections.map((s) => s.label).join(' -> ')}\n\n` +
        `Below, each section label with the preset you chose for it and that preset's strip.`,
    ),
  ]
  for (const section of labels) {
    const name = input.presets[section.label]
    parts.push(
      text(
        `${sectionLine(section)}\n  chosen preset: ${JSON.stringify(name)} — ${catalog[name]?.description ?? ''}`,
      ),
    )
    const strip = strips(name)
    if (strip) parts.push(image(strip))
  }
  const names = usablePresetNames(input.feedback, catalog)
  parts.push(
    text(
      `WHAT TO DO\n` +
        `Look at each strip against the look and against its section. Mark a preset as fitting ` +
        `(fits: true) or as contradicting the look (fits: false): the wrong colors for this song's ` +
        `palette, the wrong kind of motion or mood for the section, a frame that blows out or goes ` +
        `to noise, or simply not what its description promised. Judge the pixels, not the ` +
        `description. Give one short reason either way.\n` +
        `For every preset you mark as not fitting, name up to ${SHORTLIST_MAX} alternatives from ` +
        `the list below that you expect to fit better. You will be shown their strips next and ` +
        `can still keep the original. Do not name a preset that another section of this song ` +
        `already uses. For presets that fit, leave alternatives empty.\n` +
        `Return one verdict per section label.\n\n` +
        `THE PRESETS YOU MAY NAME\n` +
        `One per line: name, description, axes [arousal, valence, tension, warmth], imagery, ` +
        `dominant colors, and two measured numbers. Copy names exactly.\n` +
        `${measuredGuide(catalog)}\n\n` +
        names.map((name) => presetLine(name, catalog[name])).join('\n'),
    ),
  )
  return parts
}

/** Stage two: the strips of the alternatives; replace, or keep the original. */
export function buildSwapPrompt(
  input: ReviewInput,
  misfits: readonly Misfit[],
  strips: StripSource,
  catalog: Record<string, CatalogEntry> = CATALOG,
): PromptPart[] {
  const parts: PromptPart[] = [
    text(
      `You are reviewing the background presets of one song in a music visualizer. ` +
        `${STRIP_NOTE}\n\n${lookBlock(input)}\n\n` +
        `You marked the presets below as contradicting the look. For each section you see the ` +
        `original again, then the alternatives you named.`,
    ),
  ]
  for (const misfit of misfits) {
    const section = input.sections.find((s) => s.label === misfit.label)
    parts.push(
      text(
        `SECTION ${section ? sectionLine(section).slice(2) : `"${misfit.label}"`}\n` +
          `ORIGINAL ${JSON.stringify(misfit.original)} — ${catalog[misfit.original]?.description ?? ''}\n` +
          `Your objection: ${misfit.reason}`,
      ),
    )
    const original = strips(misfit.original)
    if (original) parts.push(image(original))
    for (const name of misfit.shortlist) {
      parts.push(text(`ALTERNATIVE ${JSON.stringify(name)} — ${catalog[name]?.description ?? ''}`))
      const strip = strips(name)
      if (strip) parts.push(image(strip))
    }
  }
  const others = Object.entries(input.presets).filter(
    ([label]) => !misfits.some((misfit) => misfit.label === label),
  )
  parts.push(
    text(
      `WHAT TO CHOOSE\n` +
        `For each section above (${misfits.map((m) => `"${m.label}"`).join(', ')}), pick the ` +
        `preset whose strip fits the look and the section best: one of its alternatives, or the ` +
        `original if none of them is better. Give one short reason.\n` +
        `- Use only the original or an alternative shown for that section, name copied exactly.\n` +
        `- No preset may serve two different sections of the song.` +
        (others.length > 0
          ? ` These stay as they are: ${others.map(([label, name]) => `"${label}": ${JSON.stringify(name)}`).join('; ')}.`
          : ''),
    ),
  )
  return parts
}

/**
 * Turn the verdicts into misfits with clean shortlists: only names that
 * exist and may play, have a strip to show, are not the original and are
 * not used by another label. Returns shape problems for a retry.
 */
export function misfitsFrom(
  verdicts: z.infer<typeof ReviewVerdictSchema>['verdicts'],
  input: ReviewInput,
  strips: StripSource,
  catalog: Record<string, CatalogEntry> = CATALOG,
): { misfits: Misfit[]; errors: string[]; dropped: string[] } {
  const labels = sectionsByLabel(input.sections).map((section) => section.label)
  const errors: string[] = []
  const dropped: string[] = []
  const seen = new Set<string>()
  for (const verdict of verdicts) {
    if (!labels.includes(verdict.label)) errors.push(`"${verdict.label}" is not a section label of this song`)
    else if (seen.has(verdict.label)) errors.push(`"${verdict.label}" has two verdicts; one per label`)
    seen.add(verdict.label)
  }
  for (const label of labels) {
    if (!seen.has(label)) errors.push(`no verdict for "${label}"`)
  }
  if (errors.length > 0) return { misfits: [], errors, dropped }

  const inUse = new Set(Object.values(input.presets))
  const usable = new Set(usablePresetNames(input.feedback, catalog))
  const misfits: Misfit[] = []
  for (const verdict of verdicts) {
    if (verdict.fits) continue
    const shortlist: string[] = []
    for (const name of verdict.alternatives) {
      const why = !usable.has(name)
        ? 'not a usable preset in the list'
        : inUse.has(name)
          ? 'already used by this song'
          : strips(name) === null
            ? 'no strip on disk'
            : shortlist.includes(name)
              ? 'named twice'
              : null
      if (why) dropped.push(`"${name}" for "${verdict.label}": ${why}`)
      else if (shortlist.length < SHORTLIST_MAX) shortlist.push(name)
    }
    misfits.push({
      label: verdict.label,
      original: input.presets[verdict.label],
      reason: verdict.reason,
      shortlist,
    })
  }
  return { misfits, errors: [], dropped }
}

/**
 * The review. Runs only when every chosen preset has its strip on disk;
 * otherwise it is skipped and says so. Never leaves the set worse off:
 * an invalid or failed review keeps the presets as they were.
 */
export async function reviewPresets(
  input: ReviewInput,
  strips: StripSource,
  ask: Ask,
  log: (message: string) => void = () => {},
  catalog: Record<string, CatalogEntry> = CATALOG,
): Promise<ReviewResult> {
  const unchanged = { presets: { ...input.presets }, swaps: [], kept: [] }
  const labels = sectionsByLabel(input.sections).map((section) => section.label)
  const missing = labels.filter((label) => {
    const name = input.presets[label]
    return name === undefined || strips(name) === null
  })
  if (missing.length > 0) {
    return {
      ran: false,
      skipped:
        `no strip on disk for the preset of ${missing.map((label) => `"${label}"`).join(', ')} ` +
        `(npm run catalog renders them)`,
      ...unchanged,
    }
  }
  try {
    const first = await askUntilValid(
      buildReviewPrompt(input, strips, catalog),
      ReviewVerdictSchema,
      ask,
      ({ verdicts }) => {
        const result = misfitsFrom(verdicts, input, strips, catalog)
        for (const note of result.dropped) log(`  dropped alternative ${note}`)
        return result.errors.length > 0
          ? { value: null, errors: result.errors }
          : { value: result.misfits, errors: [] }
      },
      log,
      'review of the strips',
    )
    if (first.value === null) {
      return { ran: false, skipped: `the review stayed invalid: ${first.errors.slice(0, 2).join('; ')}`, ...unchanged }
    }
    const kept: ReviewResult['kept'] = first.value
      .filter((misfit) => misfit.shortlist.length === 0)
      .map((misfit) => ({ label: misfit.label, preset: misfit.original, reason: `${misfit.reason} (no usable alternative to show)` }))
    const open = first.value.filter((misfit) => misfit.shortlist.length > 0)
    if (open.length === 0) return { ran: true, presets: { ...input.presets }, swaps: [], kept }

    const second = await askUntilValid(
      buildSwapPrompt(input, open, strips, catalog),
      ReviewSwapSchema,
      ask,
      ({ choices }) => {
        const errors: string[] = []
        const next = { ...input.presets }
        const reasons = new Map<string, string>()
        for (const misfit of open) {
          const mine = choices.filter((choice) => choice.label === misfit.label)
          if (mine.length !== 1) {
            errors.push(`exactly one choice is needed for "${misfit.label}"`)
          } else if (mine[0].preset !== misfit.original && !misfit.shortlist.includes(mine[0].preset)) {
            errors.push(
              `"${mine[0].preset}" was not shown for "${misfit.label}"; pick the original or one of its alternatives`,
            )
          } else {
            next[misfit.label] = mine[0].preset
            reasons.set(misfit.label, mine[0].reason)
          }
        }
        for (const choice of choices) {
          if (!open.some((misfit) => misfit.label === choice.label)) {
            errors.push(`"${choice.label}" is not one of the sections under review`)
          }
        }
        if (errors.length === 0) errors.push(...presetSetProblems(next, labels, input.feedback, catalog))
        return errors.length > 0 ? { value: null, errors } : { value: { next, reasons }, errors: [] }
      },
      log,
      'replacements',
    )
    if (second.value === null) {
      log('  no valid replacements from the model; keeping the set as it was')
      return {
        ran: true,
        presets: { ...input.presets },
        swaps: [],
        kept: [
          ...kept,
          ...open.map((misfit) => ({ label: misfit.label, preset: misfit.original, reason: `${misfit.reason} (replacements stayed invalid)` })),
        ],
      }
    }
    const { next, reasons } = second.value
    const swaps: ReviewResult['swaps'] = []
    for (const misfit of open) {
      const reason = reasons.get(misfit.label) ?? ''
      if (next[misfit.label] === misfit.original) {
        kept.push({ label: misfit.label, preset: misfit.original, reason })
      } else {
        swaps.push({ label: misfit.label, from: misfit.original, to: next[misfit.label], reason })
      }
    }
    return { ran: true, presets: next, swaps, kept }
  } catch (error) {
    return {
      ran: false,
      skipped: `the review call failed: ${error instanceof Error ? error.message : String(error)}`,
      ...unchanged,
    }
  }
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
