import { TEXT } from './tuning'

/**
 * ESTIMATE, not ground truth: the LRC is line-timed, so word onsets are
 * guessed by spreading the words across the first ~70% of the line's
 * duration (capped), weighted by word length — a longer word is assumed
 * to take longer to sing, pushing later words back. Real word timing
 * would need alignment tooling, which is out of scope for this spike.
 */
export function estimateWordOnsets(
  words: readonly string[],
  lineStart: number,
  lineDuration: number,
): number[] {
  if (words.length === 0) return []
  const span = Math.min(Math.max(lineDuration, 0) * TEXT.onsetSpread, TEXT.onsetSpanCap)
  let total = 0
  const weights = words.map((word) => {
    total += word.length
    return word.length
  })
  const onsets: number[] = []
  let before = 0
  for (const weight of weights) {
    onsets.push(lineStart + (total > 0 ? (span * before) / total : 0))
    before += weight
  }
  return onsets
}
