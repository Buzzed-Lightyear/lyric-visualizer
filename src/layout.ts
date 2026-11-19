/**
 * Home-slot layouts. All are pure given a measure function, so tests can
 * fake text metrics. Slots carry their own fontSize (slot.h): lockup and
 * focus size words differently within one line.
 *
 * - centered: the line centered, wrapped to at most three rows.
 * - lockup: every row scaled to the same width, forming one block.
 * - focus: one word at a time, large and centered (slow lines only).
 */

import { TEXT } from './tuning'

export type LayoutName = 'centered' | 'lockup' | 'focus'
export const LAYOUT_NAMES: LayoutName[] = ['centered', 'lockup', 'focus']

export interface Slot {
  text: string
  /** Center, in pixels. */
  x: number
  y: number
  w: number
  /** The word's font size in px. */
  h: number
  row: number
}

export interface LineLayout {
  slots: Slot[]
  /** Base font size (rows may differ in lockup/focus; see slot.h). */
  fontSize: number
  rows: number
}

export type MeasureFn = (text: string, fontSize: number) => number

export const MAX_ROWS = 3

function wrapRows(
  words: readonly string[],
  fontSize: number,
  maxWidth: number,
  measure: MeasureFn,
): { rows: string[][]; widest: number } {
  const space = fontSize * TEXT.wordSpaceFrac
  const rows: string[][] = []
  let row: string[] = []
  let rowWidth = 0
  let widest = 0
  for (const word of words) {
    const wordWidth = measure(word, fontSize)
    const next = row.length === 0 ? wordWidth : rowWidth + space + wordWidth
    if (row.length > 0 && next > maxWidth) {
      rows.push(row)
      widest = Math.max(widest, rowWidth)
      row = [word]
      rowWidth = wordWidth
    } else {
      row = [...row, word]
      rowWidth = next
    }
  }
  if (row.length > 0) {
    rows.push(row)
    widest = Math.max(widest, rowWidth)
  }
  return { rows, widest }
}

function fitWrap(
  words: readonly string[],
  viewW: number,
  viewH: number,
  measure: MeasureFn,
  sizeScale: number,
): { rows: string[][]; fontSize: number } {
  const minDim = Math.min(viewW, viewH)
  const maxWidth = viewW * TEXT.maxWidthFrac
  const minSize = minDim * TEXT.minSizeFrac
  let fontSize = minDim * TEXT.baseSizeFrac * sizeScale
  let rows: string[][] = []
  for (;;) {
    const wrapped = wrapRows(words, fontSize, maxWidth, measure)
    rows = wrapped.rows
    if ((rows.length <= MAX_ROWS && wrapped.widest <= maxWidth) || fontSize <= minSize) break
    fontSize *= 0.92
  }
  return { rows, fontSize }
}

function placeRow(
  row: readonly string[],
  fontSize: number,
  y: number,
  rowIndex: number,
  viewW: number,
  measure: MeasureFn,
  slots: Slot[],
): void {
  const space = fontSize * TEXT.wordSpaceFrac
  const widths = row.map((word) => measure(word, fontSize))
  const rowWidth = widths.reduce((a, b) => a + b, 0) + space * (row.length - 1)
  let cursor = (viewW - rowWidth) / 2
  row.forEach((word, i) => {
    slots.push({
      text: word,
      x: cursor + widths[i] / 2,
      y,
      w: widths[i],
      h: fontSize,
      row: rowIndex,
    })
    cursor += widths[i] + space
  })
}

export function layoutCentered(
  words: readonly string[],
  viewW: number,
  viewH: number,
  measure: MeasureFn,
  sizeScale: number,
): LineLayout {
  if (words.length === 0) return { slots: [], fontSize: 0, rows: 0 }
  const { rows, fontSize } = fitWrap(words, viewW, viewH, measure, sizeScale)
  const rowHeight = fontSize * TEXT.rowGap
  const top = viewH * TEXT.centerY - (rows.length * rowHeight) / 2 + rowHeight / 2
  const slots: Slot[] = []
  rows.forEach((row, rowIndex) => {
    placeRow(row, fontSize, top + rowIndex * rowHeight, rowIndex, viewW, measure, slots)
  })
  return { slots, fontSize, rows: rows.length }
}

/** Every row scaled to one block width. */
export function layoutLockup(
  words: readonly string[],
  viewW: number,
  viewH: number,
  measure: MeasureFn,
  sizeScale: number,
): LineLayout {
  if (words.length === 0) return { slots: [], fontSize: 0, rows: 0 }
  const minDim = Math.min(viewW, viewH)
  const { rows, fontSize } = fitWrap(words, viewW, viewH, measure, sizeScale)
  const target = viewW * TEXT.maxWidthFrac * 0.8
  const minSize = minDim * TEXT.minSizeFrac
  const maxSize = minDim * 0.22
  // measureText is linear in font size, so one reference measure per row
  // gives the exact scale to hit the block width.
  const rowSizes = rows.map((row) => {
    const space = fontSize * TEXT.wordSpaceFrac
    const natural =
      row.reduce((a, word) => a + measure(word, fontSize), 0) + space * (row.length - 1)
    return Math.max(minSize, Math.min(maxSize, (fontSize * target) / Math.max(1, natural)))
  })
  const totalHeight = rowSizes.reduce((a, size) => a + size * TEXT.rowGap, 0)
  let y = viewH * TEXT.centerY - totalHeight / 2
  const slots: Slot[] = []
  rows.forEach((row, rowIndex) => {
    const size = rowSizes[rowIndex]
    y += (size * TEXT.rowGap) / 2
    placeRow(row, size, y, rowIndex, viewW, measure, slots)
    y += (size * TEXT.rowGap) / 2
  })
  return { slots, fontSize, rows: rows.length }
}

/** One word at a time, large and centered; one slot per word, same spot. */
export function layoutFocus(
  words: readonly string[],
  viewW: number,
  viewH: number,
  measure: MeasureFn,
  sizeScale: number,
): LineLayout {
  if (words.length === 0) return { slots: [], fontSize: 0, rows: 0 }
  const minDim = Math.min(viewW, viewH)
  const minSize = minDim * TEXT.minSizeFrac
  const maxWidth = viewW * 0.8
  const slots: Slot[] = words.map((word) => {
    let size = minDim * TEXT.baseSizeFrac * sizeScale * 2.2
    while (measure(word, size) > maxWidth && size > minSize) size *= 0.92
    return {
      text: word,
      x: viewW / 2,
      y: viewH * TEXT.centerY,
      w: measure(word, size),
      h: size,
      row: 0,
    }
  })
  return { slots, fontSize: slots[0]?.h ?? 0, rows: 1 }
}

/**
 * Focus is only allowed on slow lines: at or under TEXT.focusMaxPace
 * words per second, with every word readable for TEXT.focusMinWordSec.
 */
export function focusFeasible(onsets: readonly number[], lineEnd: number): boolean {
  if (onsets.length === 0) return false
  const duration = lineEnd - onsets[0]
  if (duration <= 0) return false
  if (onsets.length / duration > TEXT.focusMaxPace) return false
  for (let i = 0; i < onsets.length; i++) {
    const next = i + 1 < onsets.length ? onsets[i + 1] : lineEnd
    if (next - onsets[i] < TEXT.focusMinWordSec) return false
  }
  return true
}

export const LAYOUTS: Record<
  LayoutName,
  (words: readonly string[], w: number, h: number, m: MeasureFn, s: number) => LineLayout
> = {
  centered: layoutCentered,
  lockup: layoutLockup,
  focus: layoutFocus,
}
