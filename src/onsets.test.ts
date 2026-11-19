import { describe, expect, it } from 'vitest'
import { estimateWordOnsets } from './onsets'
import { TEXT } from './tuning'

describe('estimateWordOnsets (an estimate, not ground truth)', () => {
  const words = ['one', 'considerably', 'up', 'fabricated']

  it('starts the first word at the line start', () => {
    const onsets = estimateWordOnsets(words, 12.5, 3)
    expect(onsets[0]).toBe(12.5)
    expect(onsets).toHaveLength(words.length)
  })

  it('is non-decreasing and stays within the spread window', () => {
    const start = 30
    const duration = 4
    const onsets = estimateWordOnsets(words, start, duration)
    for (let i = 1; i < onsets.length; i++) {
      expect(onsets[i]).toBeGreaterThanOrEqual(onsets[i - 1])
      expect(onsets[i]).toBeLessThan(start + duration * TEXT.onsetSpread)
    }
  })

  it('caps the span on very long lines', () => {
    const onsets = estimateWordOnsets(words, 0, 60)
    expect(onsets[onsets.length - 1]).toBeLessThan(TEXT.onsetSpanCap)
  })

  it('gives longer words more time before the next onset', () => {
    const onsets = estimateWordOnsets(['considerably', 'up', 'xx'], 0, 4)
    const afterLong = onsets[1] - onsets[0]
    const afterShort = onsets[2] - onsets[1]
    expect(afterLong).toBeGreaterThan(afterShort)
  })

  it('handles empty and single-word lines', () => {
    expect(estimateWordOnsets([], 0, 3)).toEqual([])
    expect(estimateWordOnsets(['solo'], 7, 3)).toEqual([7])
  })
})
