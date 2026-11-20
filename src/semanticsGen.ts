/**
 * LLM semantics extraction: the prompt and the output schema (roadmap step
 * 4). Pure module — the API call itself lives in scripts/generateSemantics.ts
 * so no SDK code can ever reach the browser bundle; here the model is an
 * injected `ask` function, which is also how the tests mock it.
 *
 * Version 3: the model reads the whole song and gives it its own look.
 * There is no list of moods or imagery to choose from — mood, imagery,
 * scene and the look description are the model's own words, and the four
 * axes carry the mood to the renderer as numbers. The only closed lists
 * left are the things the renderer can physically do: the eight type
 * voices, the gestures and the directions.
 *
 * The lyric words go into the prompt (the model has to read them to judge
 * meaning) but the OUTPUT is the semantics file: times, indices, enums
 * and the model's own descriptive words — never lyric text. The free-text
 * fields are length-limited (LOOK_LIMITS) and compared against the lyrics
 * before anything is written (lyricEchoProblems).
 */

import { z } from 'zod'
import { DIRECTION_WORDS, GESTURE_NAMES } from './gestures'
import type { LyricLine } from './lrc'
import { LOOK_LIMITS, parseSemantics } from './semantics'
import { automaticChecks } from './semanticsChecks'
import { VOICE_DESCRIPTIONS, VOICE_NAME_LIST } from './voiceNames'

/** What the script feeds the model: indexed lines with indexed words. */
export interface ExtractionLine {
  index: number
  /** Seconds. */
  time: number
  words: string[]
}

export interface ExtractionInput {
  title: string
  artist: string
  durationSec: number
  lines: ExtractionLine[]
}

const VoiceEnum = z.enum(VOICE_NAME_LIST)

/** The song-level look as the model writes it; presets are chosen in a second step. */
export const LookDraftSchema = z.object({
  description: z.string(),
  palette: z.array(z.string()),
  voices: z.object({ main: VoiceEnum, accent: VoiceEnum }),
})

export type LookDraft = z.infer<typeof LookDraftSchema>

// Nullable-not-optional keeps the compiled JSON schema strict-friendly;
// stripNulls() turns nulls back into absent fields before validation.
export const SemanticsOutputSchema = z.object({
  version: z.literal(3),
  look: LookDraftSchema,
  sections: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      label: z.string(),
      energy: z.number(),
      mood: z.string(),
      axes: z.object({
        arousal: z.number(),
        valence: z.number(),
        tension: z.number(),
        warmth: z.number(),
      }),
      palette: z.array(z.string()),
      imagery: z.array(z.string()),
      scene: z.string(),
      voice: z.enum(['main', 'accent']),
    }),
  ),
  lines: z.array(
    z.object({
      time: z.number(),
      emphasis: z.number(),
      focus: z.array(z.number().int()).nullable(),
      gesture: z.enum(GESTURE_NAMES as unknown as [string, ...string[]]).nullable(),
      direction: z.enum(DIRECTION_WORDS as unknown as [string, ...string[]]).nullable(),
    }),
  ),
})

export type SemanticsOutput = z.infer<typeof SemanticsOutputSchema>

/**
 * Drop focus indices that point past a line's last word — the model's most
 * common slip is an index exactly one past the end, and the renderer would
 * ignore it anyway; rejecting a whole document over it throws away good
 * annotation. A line whose focus empties loses its gesture and direction
 * too (they require focus). Every repair is reported. All other problems
 * stay hard failures.
 */
export function repairFocus(
  output: SemanticsOutput,
  lines: readonly { time: number; wordCount: number }[],
): string[] {
  const notes: string[] = []
  for (const line of output.lines) {
    if (!line.focus) continue
    const match = lines.find((l) => Math.abs(l.time - line.time) < 0.05)
    if (!match) continue // validateFocusRanges reports unmatched lines
    const kept = line.focus.filter((index) => index < match.wordCount)
    if (kept.length === line.focus.length) continue
    const dropped = line.focus.filter((index) => index >= match.wordCount)
    if (kept.length > 0) {
      notes.push(`line at ${line.time}s: dropped out-of-range focus ${dropped.join(',')}`)
      line.focus = kept
    } else {
      notes.push(
        `line at ${line.time}s: dropped out-of-range focus ${dropped.join(',')}` +
          (line.gesture ? ` and its "${line.gesture}" gesture` : ''),
      )
      line.focus = null
      line.gesture = null
      line.direction = null
    }
  }
  return notes
}

/**
 * Drop null fields so the result matches the on-disk semantics format.
 * The look's presets start empty: they are chosen in the next step
 * (src/lookGen.ts), once the look is written.
 */
export function stripNulls(output: SemanticsOutput): SemanticsDoc {
  return {
    version: output.version,
    look: { ...output.look, presets: {}, source: 'api' },
    sections: output.sections,
    lines: output.lines.map((line) => ({
      time: line.time,
      emphasis: line.emphasis,
      ...(line.focus !== null ? { focus: line.focus } : {}),
      ...(line.gesture !== null ? { gesture: line.gesture } : {}),
      ...(line.direction !== null ? { direction: line.direction } : {}),
    })),
  }
}

/** The generated version 3 document, as written to disk. */
export interface SemanticsDoc {
  version: 3
  look: LookDraft & {
    presets: Record<string, string>
    presetsFrom?: 'model' | 'scorer'
    review?: { ran: boolean; swapped: string[] }
    source: 'api' | 'agent'
    partial?: boolean
  }
  sections: SemanticsOutput['sections']
  lines: unknown[]
}

/** The four axes, worded as in the preset tagging rubric: one shared scale. */
export const AXES_GUIDE = `- arousal: calm (0) to intense (1).
- valence: dark and heavy (0) to bright and uplifting (1).
- tension: smooth (0) to harsh or chaotic (1).
- warmth: cool (0) to warm (1); mixed or neutral is about 0.5.`

/** The eight type voices: the one closed list in the look. */
export const VOICES_GUIDE = VOICE_NAME_LIST.map(
  (name) => `  ${name}: ${VOICE_DESCRIPTIONS[name]}`,
).join('\n')

export const NO_LYRICS_RULE = `Everything you write in words — the look description, mood, imagery and \
scene — must be your OWN description. Never quote the lyrics and never string \
together words taken from a lyric line; the file is published and must carry no \
lyric text.`

export function buildPrompt(input: ExtractionInput): string {
  const lines = input.lines
    .map(
      (line) =>
        `${line.index}  t=${line.time.toFixed(2)}  ${line.words
          .map((word, i) => `${i}:${word}`)
          .join(' ')}`,
    )
    .join('\n')

  return `You are giving a song its look for a music visualizer: a moving abstract \
background with the lyrics set as kinetic type on top. The visuals respond to the \
audio on their own; your job is the MEANING: what this song is, where its sections \
are, how each one feels, and which words carry each line.

Song: "${input.title}" by ${input.artist}, ${Math.round(input.durationSec)} seconds.

Each lyric line below has an index, a start time in seconds, and its words \
numbered from 0:

${lines}

Read the whole song before you write anything. Then produce its semantics file.

THE LOOK (one per song)
Every song in the library should be recognizable at a glance as itself. There is \
no house style and no list to choose from: the look comes from your reading of \
this song — its subject, its voice, its world, its temperature.
- description: 1-3 sentences (at most ${LOOK_LIMITS.description} characters), in your own words, saying \
how this song should look and move on screen and what sets it apart from any other \
song.
- palette: 4-${LOOK_LIMITS.lookPalette} hex colors like "#0a0d1a" for the whole song. The first is the \
darkest and is the background.
- voices: the song's two typefaces, "main" and "accent", two DIFFERENT names from \
these eight (the only fixed list here — they are the fonts that exist):
${VOICES_GUIDE}
  main sets most of the song. accent is its counterpart: a section may be set in \
it, and the lines that hit hardest (emphasis 0.85 or above) switch to it.

SECTIONS
- Cover the whole song from 0 to ${Math.round(input.durationSec)}s with no gaps and no overlaps.
- Put boundaries where the song's structure changes: intro, verses, hook/chorus, \
bridge, outro. Use the timing gaps and repeated lines to find the structure.
- Label repeats of the same part identically ("chorus", not "chorus 2"), and give \
repeats exactly the same values in every field. Distinct verses get distinct labels \
("verse 1", "verse 2").
- energy is 0..1 baseline intensity.
- mood: a few words of your own (at most ${LOOK_LIMITS.mood} characters) for how this section \
feels. Any words; be specific to this song.
- axes: four numbers 0..1 that place that mood. The renderer reads these numbers, \
not the words, so make them agree with the words:
${AXES_GUIDE}
- palette: 3-5 hex colors for this section, a variation WITHIN the song's palette: \
the same world, shifted for this section. The first is the background and must be \
dark.
- imagery: 1-4 short tags of your own (at most ${LOOK_LIMITS.imageryTag} characters each): what this \
section would show if it were a picture.
- scene: one line (at most ${LOOK_LIMITS.scene} characters) describing this section's scene.
- voice: "main" or "accent" — which of the song's two voices this section is set in.

LINES
- Annotate every lyric line (one entry per index above, using its exact time).
- emphasis is 0..1: how hard this line should land. Most lines sit near 0.5; \
reserve values above 0.8 for the few lines that hit hardest.
- focus: the 1-2 word indices that carry the line's meaning. Give focus to most \
lines; leave it off lines with no clear carrying word. Use ONLY the indices \
printed next to the words above — a line whose last word is numbered N has no \
index N+1.
- gesture: a named move the focus words perform. Give gestures to roughly a \
third of the lines — the ones where the WORDS themselves act. If every line \
gets a special move it reads as random again. A gesture requires focus.
  Vocabulary: fall (drops), rise (floats up), strike (slams in huge), break \
(arrives shattered and shuddering), drift (slides sideways), tremble (shivers), \
swell (grows), shrink (contracts), rush (whips in fast), halt (cuts off dead), \
apart (letters spread), together (letters assemble), echo (ghost rings), hang \
(dangles), linger (outstays the line's exit).
- direction: only for a gesture that clearly moves one way (left, right, up, \
down); use it rarely. A direction requires a gesture.
- Repeated lines (refrains) are detected automatically and reuse the first \
occurrence's choreography. Annotate the FIRST occurrence; later repeats can \
carry just time and emphasis.

${NO_LYRICS_RULE} Words are referred to by index only.`
}

// --- running the model ---------------------------------------------------------

/** A prompt is plain text, or text with images in between (the review stage). */
export type PromptPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/png' | 'image/jpeg'; /** base64 */ data: string }

export type Prompt = string | PromptPart[]

/** The words of a prompt, images left out (logs and tests). */
export function promptText(prompt: Prompt): string {
  if (typeof prompt === 'string') return prompt
  return prompt
    .filter((part): part is Extract<PromptPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

/**
 * One model call: a prompt and the schema its JSON answer must follow.
 * Returns the parsed JSON, or the reasons there is none (refusal, cut
 * off, not JSON). scripts/generateSemantics.ts implements it with the
 * SDK; tests pass a fake.
 */
export type Ask = (
  prompt: Prompt,
  schema: z.ZodType,
) => Promise<{ raw: unknown; errors?: undefined } | { raw?: undefined; errors: string[] }>

/** How many times a call is tried before giving up (1 + two retries). */
export const MAX_ATTEMPTS = 3

/**
 * Ask until the answer is valid: schema first, then `validate`. Each
 * retry carries the previous attempt's problems back to the model.
 */
export async function askUntilValid<S extends z.ZodType, T>(
  basePrompt: Prompt,
  schema: S,
  ask: Ask,
  validate: (output: z.infer<S>) => { value: T | null; errors: string[] },
  log: (message: string) => void = () => {},
  what = 'answer',
): Promise<{ value: T | null; errors: string[]; attempts: number }> {
  let prompt: Prompt = basePrompt
  let lastErrors: string[] = []
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    log(`  asking for the ${what} (attempt ${attempt} of ${MAX_ATTEMPTS})...`)
    const answer = await ask(prompt, schema)
    if (answer.errors) {
      lastErrors = answer.errors
    } else {
      const checked = schema.safeParse(answer.raw)
      if (!checked.success) {
        lastErrors = checked.error.issues.map(
          (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
        )
      } else {
        const result = validate(checked.data)
        if (result.value !== null) return { value: result.value, errors: [], attempts: attempt }
        lastErrors = result.errors
      }
    }
    log(
      `  invalid ${what}: ${lastErrors.slice(0, 3).join('; ')}${lastErrors.length > 3 ? '; ...' : ''}`,
    )
    const problems =
      `\n\nYour previous attempt had these problems — fix every one of them:\n` +
      lastErrors.map((error) => `- ${error}`).join('\n')
    prompt =
      typeof basePrompt === 'string'
        ? basePrompt + problems
        : [...basePrompt, { type: 'text', text: problems }]
  }
  return { value: null, errors: lastErrors, attempts: MAX_ATTEMPTS }
}

/**
 * The extraction: prompt -> schema-constrained output -> repair -> the
 * app's own parser -> the automatic checks. Up to two retries carry the
 * problems back. Returns the document (look.presets still empty), or the
 * last attempt's problems.
 */
export async function extractSemantics(
  input: ExtractionInput,
  lrcLines: readonly LyricLine[],
  ask: Ask,
  log: (message: string) => void = () => {},
): Promise<{ doc: SemanticsDoc | null; errors: string[] }> {
  const wordCounts = lrcLines.map((line) => ({
    time: line.time,
    wordCount: line.text.split(/\s+/).filter(Boolean).length,
  }))
  const result = await askUntilValid(
    buildPrompt(input),
    SemanticsOutputSchema,
    ask,
    (output) => {
      for (const note of repairFocus(output, wordCounts)) log(`  repaired: ${note}`)
      const doc = stripNulls(output)
      const { semantics, errors } = parseSemantics(doc)
      if (!semantics) return { value: null, errors }
      const problems = automaticChecks(semantics, lrcLines, input.durationSec)
      if (problems.length > 0) {
        log(`  the document failed ${problems.length} automatic check(s)`)
        return { value: null, errors: problems }
      }
      return { value: doc, errors: [] }
    },
    log,
    'semantics',
  )
  return { doc: result.value, errors: result.errors }
}
