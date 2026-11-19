import { describe, expect, it } from 'vitest'
import {
  focusFeasible,
  layoutCentered,
  layoutFocus,
  layoutLockup,
  MAX_ROWS,
  phraseBreak,
  type LayoutInput,
  type TypeStyle,
} from './layout'
import { TEXT, TYPESET } from './tuning'

// Fake metrics: width proportional to character count and font size.
const measure = (text: string, fontSize: number) => 0.6 * fontSize * text.length

const W = 1280
const H = 720

const style = (over: Partial<TypeStyle> = {}): TypeStyle => ({
  wordSpaceFrac: 0.3,
  leadingFrac: 1.22,
  sizeAdjust: 1,
  ...over,
})

const input = (words: string[], over: Partial<LayoutInput> = {}): LayoutInput => ({
  words,
  viewW: W,
  viewH: H,
  measure,
  style: style(),
  sizeScale: 1,
  focus: [],
  anchor: 'center',
  ...over,
})

function rowWidths(slots: { row: number; x: number; w: number }[]): number[] {
  const rows = new Map<number, { left: number; right: number }>()
  for (const slot of slots) {
    const entry = rows.get(slot.row) ?? { left: Infinity, right: -Infinity }
    entry.left = Math.min(entry.left, slot.x - slot.w / 2)
    entry.right = Math.max(entry.right, slot.x + slot.w / 2)
    rows.set(slot.row, entry)
  }
  return [...rows.values()].map((r) => r.right - r.left)
}

describe('layoutCentered', () => {
  it('returns nothing for no words', () => {
    expect(layoutCentered(input([]))).toEqual({ slots: [], fontSize: 0, rows: 0 })
  })

  it('keeps a short line on one centered row', () => {
    const { slots, rows } = layoutCentered(input(['TWO', 'WORDS']))
    expect(rows).toBe(1)
    expect(slots).toHaveLength(2)
    const left = slots[0].x - slots[0].w / 2
    const right = slots[1].x + slots[1].w / 2
    expect(left + right).toBeCloseTo(W, 0) // centered
  })

  it('spaces words by the style word space, not a flat fraction', () => {
    const wide = layoutCentered(input(['AA', 'BB'], { style: style({ wordSpaceFrac: 0.6 }) }))
    const slim = layoutCentered(input(['AA', 'BB'], { style: style({ wordSpaceFrac: 0.2 }) }))
    const gap = (l: typeof wide) => l.slots[1].x - l.slots[1].w / 2 - (l.slots[0].x + l.slots[0].w / 2)
    expect(gap(wide)).toBeCloseTo(0.6 * wide.fontSize, 5)
    expect(gap(slim)).toBeCloseTo(0.2 * slim.fontSize, 5)
  })

  it('wraps long lines to at most three rows inside the margins', () => {
    const words = 'eleven made up words that keep going and keep on going'.split(' ')
    const { slots, rows } = layoutCentered(input(words))
    expect(rows).toBeLessThanOrEqual(MAX_ROWS)
    for (const slot of slots) {
      expect(slot.x - slot.w / 2).toBeGreaterThanOrEqual(W * TYPESET.marginX - 0.01)
      expect(slot.x + slot.w / 2).toBeLessThanOrEqual(W * (1 - TYPESET.marginX) + 0.01)
    }
  })

  it('balances wrapped rows and leaves no orphan on the last row', () => {
    const words = 'several invented words that march along the glowing frame tonight'.split(' ')
    const { slots, rows } = layoutCentered(input(words))
    expect(rows).toBeGreaterThanOrEqual(2)
    const widths = rowWidths(slots)
    expect(Math.min(...widths) / Math.max(...widths)).toBeGreaterThanOrEqual(0.4)
    const lastRow = slots.filter((slot) => slot.row === rows - 1)
    const lastWidth = widths[widths.length - 1]
    expect(
      lastRow.length > 1 || lastWidth >= TYPESET.orphanFrac * Math.max(...widths),
    ).toBe(true)
  })

  it('prefers phrase-boundary breaks when widths are comparable', () => {
    // Equal-length words; the comma marks the phrase boundary at index 2.
    const words = ['aaaa', 'bbbb', 'cccc,', 'dddd', 'eeee', 'ffff']
    const { slots, rows } = layoutCentered(input(words))
    if (rows === 2) {
      const firstRow = slots.filter((slot) => slot.row === 0)
      expect(firstRow[firstRow.length - 1].text).toBe('cccc,')
    }
    expect(phraseBreak(words, 2)).toBe(true)
    expect(phraseBreak(words, 1)).toBe(false)
    expect(phraseBreak(['go', 'to', 'the', 'end'], 0)).toBe(true) // before "to"
  })

  it('scales short lines up toward the target width and long lines down', () => {
    const short = layoutCentered(input(['hey']))
    const long = layoutCentered(input(Array(18).fill('sesquipedalian')))
    expect(short.fontSize).toBeGreaterThan(Math.min(W, H) * TEXT.baseSizeFrac)
    expect(long.fontSize).toBeLessThan(short.fontSize)
    expect(long.rows).toBeLessThanOrEqual(MAX_ROWS)
  })

  it('normalizes size by cap height via sizeAdjust', () => {
    const base = layoutCentered(input(['word']))
    const smallCaps = layoutCentered(input(['word'], { style: style({ sizeAdjust: 0.8 }) }))
    expect(smallCaps.fontSize).toBeLessThan(base.fontSize)
  })

  it('never overlaps slot boxes at rest', () => {
    const words = 'a handful of fake words to pack in rows tightly here'.split(' ')
    const { slots } = layoutCentered(input(words, { sizeScale: 1.4 }))
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i]
        const b = slots[j]
        const overlapX = Math.abs(a.x - b.x) < (a.w + b.w) / 2
        const overlapY = Math.abs(a.y - b.y) < (a.h + b.h) / 2
        expect(overlapX && overlapY).toBe(false)
      }
    }
  })

  it('sets focus words larger and the rest smaller', () => {
    const { slots } = layoutCentered(input(['one', 'two', 'three'], { focus: [1] }))
    expect(slots[1].focus).toBe(true)
    expect(slots[1].h).toBeGreaterThan(slots[0].h)
    expect(slots[1].h / slots[0].h).toBeCloseTo(TYPESET.focusSize / TYPESET.restSize, 3)
  })

  it('anchors the block at center, lower third or upper left', () => {
    const words = ['anchored', 'words']
    const center = layoutCentered(input(words, { anchor: 'center' }))
    const low = layoutCentered(input(words, { anchor: 'low' }))
    const upperLeft = layoutCentered(input(words, { anchor: 'upperLeft' }))
    expect(low.slots[0].y).toBeGreaterThan(center.slots[0].y)
    expect(upperLeft.slots[0].y).toBeLessThan(center.slots[0].y)
    expect(upperLeft.slots[0].x - upperLeft.slots[0].w / 2).toBeCloseTo(
      W * TYPESET.upperLeftX,
      0,
    )
    expect(center.slots[0].x).toBeLessThan(W / 2) // centered pair straddles
  })
})

describe('layoutLockup', () => {
  it('scales every row to the same block width', () => {
    const words = 'tiny words then a considerably longer fabricated row here'.split(' ')
    const { slots, rows } = layoutLockup(input(words))
    expect(rows).toBeGreaterThan(1)
    const widths = rowWidths(slots)
    for (const width of widths) {
      expect(Math.abs(width - widths[0]) / widths[0]).toBeLessThan(0.02)
    }
  })

  it('gives a focus word its own row', () => {
    const words = ['first', 'second', 'third', 'fourth', 'fifth']
    const { slots } = layoutLockup(input(words, { focus: [2] }))
    const focusSlot = slots.find((slot) => slot.index === 2)!
    const sameRow = slots.filter((slot) => slot.row === focusSlot.row)
    expect(sameRow).toHaveLength(1)
  })
})

describe('layoutFocus', () => {
  it('puts every word large and centered on the same spot', () => {
    const { slots } = layoutFocus(input(['one', 'bigger', 'words']))
    for (const slot of slots) {
      expect(slot.x).toBe(W / 2)
      expect(slot.w).toBeLessThanOrEqual(W * 0.8 + 1)
      expect(slot.h).toBeGreaterThan(Math.min(W, H) * TEXT.baseSizeFrac)
    }
  })

  it('gates on pace: slow lines pass, fast or cramped lines fail', () => {
    expect(focusFeasible([0, 0.5, 1.0, 1.5], 2.4)).toBe(true)
    // 8 onsets in 2 s is faster than 3 words/s.
    expect(focusFeasible([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75], 2)).toBe(false)
    // A word flashed for under 0.25 s is unreadable.
    expect(focusFeasible([0, 0.1, 1.0], 2.4)).toBe(false)
    expect(focusFeasible([], 2)).toBe(false)
  })
})
