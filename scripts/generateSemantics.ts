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
  type SemanticsOutput,
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

/** Extract and schema-validate the model's structured output. */
function parseOutput(response: Anthropic.Message): {
  output: SemanticsOutput | null
  errors: string[]
} {
  if (response.stop_reason === 'refusal') {
    return { output: null, errors: ['the model declined this request (stop: refusal)'] }
  }
  if (response.stop_reason === 'max_tokens') {
    return { output: null, errors: ['the output was cut off at max_tokens'] }
  }
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { output: null, errors: ['the output was not valid JSON'] }
  }
  const checked = SemanticsOutputSchema.safeParse(raw)
  if (!checked.success) {
    return {
      output: null,
      errors: checked.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    }
  }
  return { output: checked.data, errors: [] }
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
    // Streamed: the SDK refuses non-streaming requests this large (long
    // requests risk dropped idle connections). finalMessage() hands back
    // the same Message a plain create() would.
    const response = await client.messages
      .stream({
        model,
        max_tokens: 32000,
        output_config: { format: zodOutputFormat(SemanticsOutputSchema), effort: 'high' },
        messages: [{ role: 'user', content: prompt }],
      })
      .finalMessage()
    const parsed = parseOutput(response)
    if (!parsed.output) {
      lastErrors = parsed.errors
    } else {
      const doc = stripNulls(parsed.output)
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
