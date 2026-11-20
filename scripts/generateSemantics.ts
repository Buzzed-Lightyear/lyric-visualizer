/**
 * The LLM side of semantics extraction (roadmap step 4). Node-only: the
 * key comes from ANTHROPIC_API_KEY in .env and never reaches the browser
 * bundle — nothing under src/ imports this file or the SDK.
 *
 * Output is schema-constrained (structured outputs), validated with the
 * same parser the app uses, retried up to twice on invalid output, then
 * put through the automatic checks before anything is written.
 */

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { LyricLine } from '../src/lrc'
import { automaticChecks } from '../src/semanticsChecks'
import {
  buildPrompt,
  SemanticsOutputSchema,
  stripNulls,
  type ExtractionInput,
} from '../src/semanticsGen'
import { parseSemantics } from '../src/semantics'

export const DEFAULT_MODEL = 'claude-opus-5-5'

export function extractionInput(
  title: string,
  artist: string,
  durationSec: number,
  lrcLines: readonly LyricLine[],
): ExtractionInput {
  return {
    title,
    artist,
    durationSec,
    lines: lrcLines
      .filter((line) => line.text.trim() !== '')
      .map((line, index) => ({
        index,
        time: line.time,
        words: line.text.split(/\s+/).filter(Boolean),
      })),
  }
}

export interface GenerateResult {
  /** The validated semantics document, ready to write. */
  doc: unknown | null
  errors: string[]
}

/**
 * One extraction: prompt -> schema-constrained output -> validate; up to
 * two retries carry the validation errors back to the model. The automatic
 * checks run once on the final valid document.
 */
export async function generateSemantics(
  input: ExtractionInput,
  lrcLines: readonly LyricLine[],
  log: (message: string) => void = console.log,
): Promise<GenerateResult> {
  const client = new Anthropic()
  const model = process.env.SEMANTICS_MODEL ?? DEFAULT_MODEL
  const basePrompt = buildPrompt(input)
  let prompt = basePrompt
  let lastErrors: string[] = []

  for (let attempt = 1; attempt <= 3; attempt++) {
    log(`  asking ${model} (attempt ${attempt} of 3)...`)
    const response = await client.messages.parse({
      model,
      max_tokens: 32000,
      output_config: { format: zodOutputFormat(SemanticsOutputSchema), effort: 'high' },
      messages: [{ role: 'user', content: prompt }],
    })
    if (!response.parsed_output) {
      lastErrors = [`the model's output did not match the schema (stop: ${response.stop_reason})`]
    } else {
      const doc = stripNulls(response.parsed_output)
      const { semantics, errors } = parseSemantics(doc)
      if (semantics) {
        const problems = automaticChecks(semantics, lrcLines, input.durationSec)
        if (problems.length === 0) return { doc, errors: [] }
        log(`  the document failed ${problems.length} automatic check(s)`)
        lastErrors = problems
      } else {
        lastErrors = errors
      }
    }
    log(`  invalid output: ${lastErrors.slice(0, 3).join('; ')}${lastErrors.length > 3 ? '; ...' : ''}`)
    prompt =
      basePrompt +
      `\n\nYour previous attempt had these problems — fix every one of them:\n` +
      lastErrors.map((error) => `- ${error}`).join('\n')
  }
  return { doc: null, errors: lastErrors }
}
