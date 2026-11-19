import { describe, expect, it } from 'vitest'
import { layoutLine, MAX_ROWS } from './layout'
import { TEXT } from './tuning'

// Fake metrics: width proportional to character count and font size.
const measure = (text: string, fontSize: number) => 0.6 * fontSize * text.length

const W = 1280
const H = 720

describe('layoutLine', () => {
  it('returns nothing for no words', () => {
    expect(layoutLine([], W, H, measure, 1)).toEqual({ slots: [], fontSize: 0, rows: 0 })
  })

  it('keeps a short line on one centered row', () => {
    const { slots, rows } = layoutLine(['TWO', 'WORDS'], W, H, measure, 1)
    expect(rows).toBe(1)
    expect(slots).toHaveLength(2)
    const left = slots[0].x - slots[0].w / 2
    const right = slots[1].x + slots[1].w / 2
    expect(left + right).toBeCloseTo(W, 0) // centered
  })

  it('wraps long lines to at most three rows and fits the width', () => {
    const words = 'eleven made up words that keep going and keep on going'.split(' ')
    const { slots, rows } = layoutLine(words, W, H, measure, 1)
    expect(rows).toBeLessThanOrEqual(MAX_ROWS)
    for (const slot of slots) {
      expect(slot.x - slot.w / 2).toBeGreaterThanOrEqual(0)
      expect(slot.x + slot.w / 2).toBeLessThanOrEqual(W)
    }
  })

  it('shrinks the font until a very long line fits', () => {
    const short = layoutLine(['hi'], W, H, measure, 1)
    const long = layoutLine(Array(18).fill('sesquipedalian'), W, H, measure, 1)
    expect(long.fontSize).toBeLessThan(short.fontSize)
    expect(long.rows).toBeLessThanOrEqual(MAX_ROWS)
  })

  it('never overlaps slot boxes at rest', () => {
    const words = 'a handful of fake words to pack in rows tightly here'.split(' ')
    const { slots } = layoutLine(words, W, H, measure, 1.4)
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
    const small = layoutLine(['word'], W, H, measure, 0.8)
    const big = layoutLine(['word'], W, H, measure, 1.3)
    expect(big.fontSize).toBeGreaterThan(small.fontSize)
    expect(small.fontSize).toBeCloseTo(Math.min(W, H) * TEXT.baseSizeFrac * 0.8, 5)
  })
})
