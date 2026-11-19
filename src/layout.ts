/**
 * Lays the current line out into home slots: centered, wrapped to at
 * most three rows, font sized down until it fits the viewport width.
 * Pure given a measure function, so tests can fake text metrics.
 */

import { TEXT } from './tuning'

export interface Slot {
  text: string
  /** Center, in pixels. */
  x: number
  y: number
  w: number
  h: number
  row: number
}

export interface LineLayout {
  slots: Slot[]
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

export function layoutLine(
  words: readonly string[],
  viewW: number,
  viewH: number,
  measure: MeasureFn,
  sizeScale: number,
): LineLayout {
  if (words.length === 0) return { slots: [], fontSize: 0, rows: 0 }
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

  const space = fontSize * TEXT.wordSpaceFrac
  const rowHeight = fontSize * TEXT.rowGap
  const top = viewH * TEXT.centerY - (rows.length * rowHeight) / 2 + rowHeight / 2
  const slots: Slot[] = []
  rows.forEach((row, rowIndex) => {
    const widths = row.map((word) => measure(word, fontSize))
    const rowWidth = widths.reduce((a, b) => a + b, 0) + space * (row.length - 1)
    let cursor = (viewW - rowWidth) / 2
    row.forEach((word, i) => {
      slots.push({
        text: word,
        x: cursor + widths[i] / 2,
        y: top + rowIndex * rowHeight,
        w: widths[i],
        h: fontSize,
        row: rowIndex,
      })
      cursor += widths[i] + space
    })
  })
  return { slots, fontSize, rows: rows.length }
}
