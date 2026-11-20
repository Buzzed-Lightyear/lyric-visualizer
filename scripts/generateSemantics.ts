/**
 * The LLM side of semantics extraction (roadmap step 4). Node-only: the
 * key comes from ANTHROPIC_API_KEY in .env and never reaches the browser
 * bundle — nothing under src/ imports this file or the SDK.
 *
 * This file is only the model call. What is asked, how answers are
 * validated and retried, and what happens when they stay invalid lives
 * in src/semanticsGen.ts (the semantics and the look) and src/lookGen.ts
 * (the model's choice of presets), where the tests run it against a
 * mocked model.
 */

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { LyricLine } from '../src/lrc'
import {
  choosePresets,
  type LibraryLook,
  type PresetChoiceResult,
} from '../src/lookGen'
import type { Feedback } from '../src/presetPick'
import { parseSemantics } from '../src/semantics'
import {
  extractSemantics,
  type Ask,
  type ExtractionInput,
  type SemanticsDoc,
} from '../src/semanticsGen'

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

/**
 * The real model behind `Ask`: one schema-constrained request per call
 * (structured outputs), streamed — the SDK refuses non-streaming requests
 * this large, and long requests risk dropped idle connections.
 * finalMessage() hands back the same Message a plain create() would.
 */
export function apiAsk(): Ask {
  const client = new Anthropic()
  const model = process.env.SEMANTICS_MODEL ?? DEFAULT_MODEL
  return async (prompt, schema) => {
    const response = await client.messages
      .stream({
        model,
        max_tokens: 32000,
        output_config: { format: zodOutputFormat(schema), effort: 'high' },
        messages: [{ role: 'user', content: prompt }],
      })
      .finalMessage()
    if (response.stop_reason === 'refusal') {
      return { errors: ['the model declined this request (stop: refusal)'] }
    }
    if (response.stop_reason === 'max_tokens') {
      return { errors: ['the output was cut off at max_tokens'] }
    }
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
    try {
      return { raw: JSON.parse(text) as unknown }
    } catch {
      return { errors: ['the output was not valid JSON'] }
    }
  }
}

export interface GenerateResult {
  /** The validated version 3 document, ready to write. */
  doc: SemanticsDoc | null
  errors: string[]
  /** How the preset set was chosen; null when there is no document. */
  presets: PresetChoiceResult | null
}

/**
 * A whole song: first the semantics and the look, then — with the look
 * written — the model's choice of one preset per section label.
 */
export async function generateSemantics(
  input: ExtractionInput,
  lrcLines: readonly LyricLine[],
  context: { feedback: Feedback; library: readonly LibraryLook[] },
  log: (message: string) => void = console.log,
  ask: Ask = apiAsk(),
): Promise<GenerateResult> {
  const { doc, errors } = await extractSemantics(input, lrcLines, ask, log)
  if (!doc) return { doc: null, errors, presets: null }
  const sections = parseSemantics(doc).semantics?.sections ?? []
  log('choosing the scenes...')
  const presets = await choosePresets(
    {
      title: input.title,
      artist: input.artist,
      look: doc.look,
      sections,
      feedback: context.feedback,
      library: context.library,
    },
    ask,
    log,
  )
  doc.look.presets = presets.presets
  doc.look.presetsFrom = presets.from
  return { doc, errors: [], presets }
}
