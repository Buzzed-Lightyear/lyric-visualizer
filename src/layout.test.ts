import { describe, expect, it } from 'vitest'
import { focusFeasible, layoutCentered, layoutFocus, layoutLockup, MAX_ROWS } from './layout'
import { TEXT } from './tuning'

// Fake metrics: width proportional to character count and font size.
const measure = (text: string, fontSize: number) => 0.6 * fontSize * text.length

const W = 1280
const H = 720

describe('layoutCentered', () => {
  it('returns nothing for no words', () => {
    expect(layoutCentered([], W, H, measure, 1)).toEqual({ slots: [], fontSize: 0, rows: 0 })
  })

  it('keeps a short line on one centered row', () => {
    const { slots, rows } = layoutCentered(['TWO', 'WORDS'], W, H, measure, 1)
    expect(rows).toBe(1)
    expect(slots).toHaveLength(2)
    const left = slots[0].x - slots[0].w / 2
    const right = slots[1].x + slots[1].w / 2
    expect(left + right).toBeCloseTo(W, 0) // centered
  })

  it('wraps long lines to at most three rows and fits the width', () => {
    const words = 'eleven made up words that keep going and keep on going'.split(' ')
    const { slots, rows } = layoutCentered(words, W, H, measure, 1)
    expect(rows).toBeLessThanOrEqual(MAX_ROWS)
    for (const slot of slots) {
      expect(slot.x - slot.w / 2).toBeGreaterThanOrEqual(0)
      expect(slot.x + slot.w / 2).toBeLessThanOrEqual(W)
    }
  })

  it('shrinks the font until a very long line fits', () => {
    const short = layoutCentered(['hi'], W, H, measure, 1)
    const long = layoutCentered(Array(18).fill('sesquipedalian'), W, H, measure, 1)
    expect(long.fontSize).toBeLessThan(short.fontSize)
    expect(long.rows).toBeLessThanOrEqual(MAX_ROWS)
  })

  it('never overlaps slot boxes at rest', () => {
    const words = 'a handful of fake words to pack in rows tightly here'.split(' ')
    const { slots } = layoutCentered(words, W, H, measure, 1.4)
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

  it('scales the base size with sizeScale', () => {
    const small = layoutCentered(['word'], W, H, measure, 0.8)
    const big = layoutCentered(['word'], W, H, measure, 1.3)
    expect(big.fontSize).toBeGreaterThan(small.fontSize)
    expect(small.fontSize).toBeCloseTo(Math.min(W, H) * TEXT.baseSizeFrac * 0.8, 5)
  })
})

describe('layoutLockup', () => {
  it('scales every row to the same block width', () => {
    const words = 'tiny words then a considerably longer fabricated row here'.split(' ')
    const { slots, rows } = layoutLockup(words, W, H, measure, 1)
    expect(rows).toBeGreaterThan(1)
    const rowWidths = new Map<number, { left: number; right: number }>()
    for (const slot of slots) {
      const entry = rowWidths.get(slot.row) ?? { left: Infinity, right: -Infinity }
      entry.left = Math.min(entry.left, slot.x - slot.w / 2)
      entry.right = Math.max(entry.right, slot.x + slot.w / 2)
      rowWidths.set(slot.row, entry)
    }
    const widths = [...rowWidths.values()].map((r) => r.right - r.left)
    for (const width of widths) {
      expect(Math.abs(width - widths[0]) / widths[0]).toBeLessThan(0.02)
    }
  })

  it('gives rows different font sizes to hit the block width', () => {
    const { slots } = layoutLockup(['short', 'a considerably longer row'].join(' ').split(' '), W, H, measure, 1)
    const sizes = new Set(slots.map((slot) => Math.round(slot.h)))
    expect(sizes.size).toBeGreaterThanOrEqual(1)
  })
})

describe('layoutFocus', () => {
  it('puts every word large and centered on the same spot', () => {
    const { slots } = layoutFocus(['one', 'bigger', 'words'], W, H, measure, 1)
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
