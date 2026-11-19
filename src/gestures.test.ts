import { describe, expect, it } from 'vitest'
import {
  GESTURE_NAMES,
  GESTURES,
  LEXICON,
  lexiconGesture,
  lexiconGestures,
} from './gestures'
import { ENTRANCE_NAMES, HOLD_NAMES } from './parts'

describe('gesture recipes', () => {
  it('builds every gesture from existing parts', () => {
    for (const name of GESTURE_NAMES) {
      const recipe = GESTURES[name]
      expect(ENTRANCE_NAMES).toContain(recipe.entrance)
      expect(HOLD_NAMES).toContain(recipe.hold)
    }
  })

  it('keeps the lexicon inside the gesture list', () => {
    for (const key of Object.keys(LEXICON)) {
      expect(GESTURE_NAMES).toContain(key)
    }
  })
})

describe('lexiconGesture (word stems)', () => {
  it('maps plain stems', () => {
    expect(lexiconGesture('fall')).toBe('fall')
    expect(lexiconGesture('wait')).toBe('halt')
    expect(lexiconGesture('apart')).toBe('apart')
    expect(lexiconGesture('again')).toBe('echo')
  })

  it('handles inflections, g-dropping and punctuation', () => {
    expect(lexiconGesture('falling')).toBe('fall')
    expect(lexiconGesture('Falls,')).toBe('fall')
    expect(lexiconGesture('fell')).toBe('fall')
    expect(lexiconGesture("leavin'")).toBe('apart')
    expect(lexiconGesture('sobbing')).toBe('tremble')
    expect(lexiconGesture('closer')).toBe('together')
    expect(lexiconGesture('bashed')).toBe('strike')
  })

  it('does not fire on lookalikes or unknown words', () => {
    expect(lexiconGesture('download')).toBeNull() // not "down"
    expect(lexiconGesture('closure')).toBeNull() // not "close"
    expect(lexiconGesture('every')).toBeNull()
    expect(lexiconGesture('')).toBeNull()
    expect(lexiconGesture('—')).toBeNull()
  })

  it('caps a line at two performing words, in order', () => {
    const words = 'they keep falling and falling and falling until they stop'.split(' ')
    const out = lexiconGestures(words)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ index: 2, gesture: 'fall', dir: null, source: 'lexicon' })
    expect(out[1].index).toBe(4)
  })

  it('finds nothing in a plain line', () => {
    expect(lexiconGestures(['some', 'ordinary', 'invented', 'words'])).toEqual([])
  })
})
