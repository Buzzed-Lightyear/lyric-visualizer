/**
 * LLM semantics extraction: the prompt and the output schema (roadmap step
 * 4). Pure module — the API call itself lives in scripts/generateSemantics.ts
 * so no SDK code can ever reach the browser bundle. The prompt encodes the
 * same rules the hand-written annotation followed: sections from structure,
 * repeats share values, focus words on most lines, gestures on about a
 * third of lines.
 *
 * The lyric words go into the prompt (the model has to read them to judge
 * meaning) but the OUTPUT is the version 2 semantics file: times, indices
 * and enums only, never lyric text.
 */

import { z } from 'zod'
import { DIRECTION_WORDS, GESTURE_NAMES } from './gestures'

/** Moods the renderer maps to motion; unknown moods fall back to neutral. */
export const KNOWN_MOODS = [
  'calm',
  'mournful',
  'suspended',
  'tense',
  'menacing',
  'furious',
  'weary',
  'grieving',
  'brooding',
  'hollow',
] as const

/** Imagery tags the renderer maps to motifs. */
export const KNOWN_IMAGERY = [
  'embers',
  'fire',
  'sparks',
  'gunmetal',
  'sirens',
  'rain',
  'storm',
  'tears',
  'stars',
  'night-sky',
  'prayer',
  'haze',
  'smoke',
  'city-night',
  'streetlights',
  'fluorescent',
  'fog',
] as const

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

// Nullable-not-optional keeps the compiled JSON schema strict-friendly;
// stripNulls() turns nulls back into absent fields before validation.
export const SemanticsOutputSchema = z.object({
  version: z.literal(2),
  sections: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      label: z.string(),
      energy: z.number(),
      mood: z.string(),
      palette: z.array(z.string()),
      imagery: z.array(z.string()),
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

/** Drop null fields so the result matches the on-disk semantics format. */
export function stripNulls(output: SemanticsOutput): unknown {
  return {
    version: output.version,
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

export function buildPrompt(input: ExtractionInput): string {
  const lines = input.lines
    .map(
      (line) =>
        `${line.index}  t=${line.time.toFixed(2)}  ${line.words
          .map((word, i) => `${i}:${word}`)
          .join(' ')}`,
    )
    .join('\n')

  return `You are annotating a song for a music visualizer. The visuals respond to \
the audio on their own; your job is only the MEANING: where the song's sections \
are, how each one feels, and which words carry each line.

Song: "${input.title}" by ${input.artist}, ${Math.round(input.durationSec)} seconds.

Each lyric line below has an index, a start time in seconds, and its words \
numbered from 0:

${lines}

Produce the semantics file for this song.

SECTIONS
- Cover the whole song from 0 to ${Math.round(input.durationSec)}s with no gaps and no overlaps.
- Put boundaries where the song's structure changes: intro, verses, hook/chorus, \
bridge, outro. Use the timing gaps and repeated lines to find the structure.
- Label repeats of the same part identically ("chorus", not "chorus 2"), and give \
repeats exactly the same energy, mood, palette and imagery. Distinct verses get \
distinct labels ("verse 1", "verse 2").
- energy is 0..1 baseline intensity. mood is one short word; strongly prefer one \
of: ${KNOWN_MOODS.join(', ')} (anything else renders as neutral motion).
- palette is 3-5 hex colors like "#0a0d1a". The first is the background and must \
be dark. The rest are accents that fit the mood.
- imagery is 1-3 short tags; strongly prefer: ${KNOWN_IMAGERY.join(', ')}.

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

The output carries NO lyric text — words are referred to by index only.`
}
