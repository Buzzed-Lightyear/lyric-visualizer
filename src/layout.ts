/**
 * Typesetting and home-slot layouts. All are pure given a measure
 * function and a TypeStyle, so tests can fake text metrics. Slots carry
 * their own fontSize (slot.h): hierarchy, lockup and focus size words
 * differently within one line.
 *
 * Rules (see README):
 * - Word space and leading come from the font's own metrics via the
 *   TypeStyle, never from a flat em fraction.
 * - Wrapping balances row widths, never leaves a lone short word on the
 *   last row, and prefers breaks at phrase boundaries.
 * - Short lines scale up toward a target width, long lines scale down,
 *   inside safe margins on every side.
 * - A line is placed at its section's anchor: center, lower third, or
 *   upper left.
 * - Focus words are set larger (the rest smaller); in lockup a focus
 *   word gets its own row.
 */

import { TEXT, TYPESET } from './tuning'

export type LayoutName = 'centered' | 'lockup' | 'focus'
export const LAYOUT_NAMES: LayoutName[] = ['centered', 'lockup', 'focus']

export type AnchorName = 'center' | 'low' | 'upperLeft'
export const ANCHOR_NAMES: AnchorName[] = ['center', 'low', 'upperLeft']

/** Everything voice-dependent the layout needs, all per px of font size. */
export interface TypeStyle {
  /** Word space: the font's own space advance times the voice factor. */
  wordSpaceFrac: number
  /** Row advance: real ascent + descent, set tighter for all-caps voices. */
  leadingFrac: number
  /** Cap-height normalization: multiplies the size clamps so the same
   * nominal size looks the same size in every voice. */
  sizeAdjust: number
}

/** Neutral fallback for tests and tooling. */
export const DEFAULT_STYLE: TypeStyle = {
  wordSpaceFrac: 0.3,
  leadingFrac: 1.22,
  sizeAdjust: 1,
}

export interface Slot {
  text: string
  /** Index of the word in the original line. */
  index: number
  /** Center, in pixels. */
  x: number
  y: number
  w: number
  /** The word's font size in px. */
  h: number
  row: number
  /** True for hierarchy focus words. */
  focus: boolean
}

export interface LineLayout {
  slots: Slot[]
  /** Base font size (words may differ; see slot.h). */
  fontSize: number
  rows: number
}

export type MeasureFn = (text: string, fontSize: number) => number

export interface LayoutInput {
  words: readonly string[]
  viewW: number
  viewH: number
  measure: MeasureFn
  style: TypeStyle
  sizeScale: number
  /** Word indices set larger and heavier. */
  focus: readonly number[]
  anchor: AnchorName
}

export const MAX_ROWS = 3

/** Where text's vertical mid sits above the baseline, in font sizes. */
const BASELINE_MID = 0.37

// --- phrase boundaries -------------------------------------------------------

const ENDS_PHRASE = /[,.;:!?…—–-]['")\]]*$/
const BREAK_BEFORE = new Set([
  'and', 'but', 'or', 'nor', 'so', 'yet', 'for', 'to', 'of', 'in', 'on', 'at',
  'with', 'from', 'into', 'over', 'under', 'through', 'like', 'than', 'as',
  'if', 'when', 'that', 'the', 'a', 'an', 'my', 'your', 'his', 'her', 'our',
  'their', 'because',
])

/** True when a wrap break after word `i` lands on a phrase boundary. */
export function phraseBreak(words: readonly string[], i: number): boolean {
  if (ENDS_PHRASE.test(words[i])) return true
  const next = words[i + 1]
  return next !== undefined && BREAK_BEFORE.has(next.toLowerCase().replace(/[^a-z']/g, ''))
}

// --- balanced wrapping -------------------------------------------------------

interface Fit {
  /** Rows of word indices. */
  rows: number[][]
  /** Widest row width per px of font size. */
  widestU: number
  cost: number
}

function rowWidthU(row: readonly number[], unitW: readonly number[], spaceU: number): number {
  let w = spaceU * (row.length - 1)
  for (const i of row) w += unitW[i]
  return w
}

/**
 * Pick the best partition of the words into `rowCount` rows: balanced
 * widths, phrase-boundary breaks, no orphan last row. `ownRow` indices
 * must sit alone in a row (lockup focus words). Returns null when the
 * constraints cannot be met at this row count.
 */
function bestPartition(
  words: readonly string[],
  unitW: readonly number[],
  spaceU: number,
  rowCount: number,
  ownRow: ReadonlySet<number>,
): Fit | null {
  const n = words.length
  if (rowCount > n) return null
  let best: Fit | null = null
  const breaks: number[] = []

  const evaluate = () => {
    const rows: number[][] = []
    let start = 0
    for (const b of [...breaks, n]) {
      rows.push(Array.from({ length: b - start }, (_, k) => start + k))
      start = b
    }
    for (const row of rows) {
      if (row.length > 1 && row.some((i) => ownRow.has(i))) return
    }
    const widths = rows.map((row) => rowWidthU(row, unitW, spaceU))
    const widestU = Math.max(...widths)
    let cost = TYPESET.rowPenalty * (rows.length - 1)
    const last = rows[rows.length - 1]
    if (
      rows.length > 1 &&
      last.length === 1 &&
      !ownRow.has(last[0]) &&
      widths[rows.length - 1] < TYPESET.orphanFrac * widestU
    ) {
      cost += 100 // orphan: a lone short word on the last row
    }
    for (const w of widths) cost += (1 - w / widestU) ** 2 / rows.length
    for (const b of breaks) {
      if (!phraseBreak(words, b - 1)) cost += TYPESET.phrasePenalty
    }
    if (!best || cost < best.cost) best = { rows, widestU, cost }
  }

  const choose = (from: number, left: number) => {
    if (left === 0) {
      evaluate()
      return
    }
    for (let b = from; b <= n - left; b++) {
      breaks.push(b)
      choose(b + 1, left - 1)
      breaks.pop()
    }
  }
  choose(1, rowCount - 1)
  return best
}

interface Sizing {
  targetPx: number
  minPx: number
  maxPx: number
  /** The comfortable size: wrap no deeper once a row count reaches it. */
  basePx: number
}

function clampSize(targetPx: number, widestU: number, s: Sizing): number {
  return Math.max(s.minPx, Math.min(s.maxPx, targetPx / Math.max(1e-6, widestU)))
}

/**
 * Choose rows and font size together: the fewest rows whose fitted size
 * (widest row scaled to the target width) reaches the base size; if none
 * does, the deepest wrap wins.
 */
function fitLine(
  words: readonly string[],
  unitW: readonly number[],
  spaceU: number,
  sizing: Sizing,
  ownRow: ReadonlySet<number>,
): { rows: number[][]; fontSize: number } {
  const minRows = Math.max(1, ownRow.size + (words.length > ownRow.size ? 1 : 0))
  let fallback: { rows: number[][]; fontSize: number } | null = null
  for (let rowCount = minRows; rowCount <= MAX_ROWS; rowCount++) {
    const fit = bestPartition(words, unitW, spaceU, rowCount, ownRow)
    if (!fit) continue
    const fontSize = clampSize(sizing.targetPx, fit.widestU, sizing)
    fallback = { rows: fit.rows, fontSize }
    if (fontSize >= sizing.basePx) return fallback
  }
  return fallback ?? { rows: [words.map((_, i) => i)], fontSize: sizing.minPx }
}

// --- placement ---------------------------------------------------------------

function wordScale(index: number, focus: readonly number[]): number {
  if (focus.length === 0) return 1
  return focus.includes(index) ? TYPESET.focusSize : TYPESET.restSize
}

interface PlacedRow {
  indices: number[]
  /** Font size used for every word in this row (lockup); 0 = per-word. */
  rowSize: number
}

/**
 * Place rows at an anchor, baseline-aligning mixed sizes within a row
 * and clamping the block to the safe margins.
 */
function placeRows(
  input: LayoutInput,
  rows: PlacedRow[],
  fontSize: number,
): Slot[] {
  const { words, viewW, viewH, measure, style, focus, anchor } = input
  const sizeOf = (i: number, row: PlacedRow) =>
    row.rowSize > 0 ? row.rowSize : fontSize * wordScale(i, focus)
  const rowHeights = rows.map(
    (row) => Math.max(...row.indices.map((i) => sizeOf(i, row))) * style.leadingFrac,
  )
  const total = rowHeights.reduce((a, b) => a + b, 0)
  const topMin = viewH * TYPESET.marginTop
  const bottomMax = viewH * (1 - TYPESET.marginBottom)
  let top: number
  if (anchor === 'upperLeft') top = viewH * TYPESET.upperLeftY
  else if (anchor === 'low') top = viewH * TYPESET.lowY - total / 2
  else top = viewH * TYPESET.centerY - total / 2
  top = Math.min(Math.max(top, topMin), Math.max(topMin, bottomMax - total))

  const slots: Slot[] = []
  let y = top
  rows.forEach((row, rowIndex) => {
    const baseline = y + rowHeights[rowIndex] * 0.78
    const sizes = row.indices.map((i) => sizeOf(i, row))
    const widths = row.indices.map((i, k) => measure(words[i], sizes[k]))
    // The space next to a larger (focus) word follows the larger size,
    // so hierarchy never glues words together.
    const gapAfter = (k: number) =>
      style.wordSpaceFrac * Math.max(sizes[k], sizes[k + 1] ?? 0)
    let rowW = widths.reduce((a, b) => a + b, 0)
    for (let k = 0; k < row.indices.length - 1; k++) rowW += gapAfter(k)
    const xMin = viewW * TYPESET.marginX
    let cursor =
      anchor === 'upperLeft' ? viewW * TYPESET.upperLeftX : (viewW - rowW) / 2
    cursor = Math.max(cursor, xMin)
    row.indices.forEach((i, k) => {
      slots.push({
        text: words[i],
        index: i,
        x: cursor + widths[k] / 2,
        y: baseline - sizes[k] * BASELINE_MID,
        w: widths[k],
        h: sizes[k],
        row: rowIndex,
        focus: focus.includes(i),
      })
      cursor += widths[k] + gapAfter(k)
    })
    y += rowHeights[rowIndex]
  })
  return slots
}

function sizingFor(input: LayoutInput): Sizing {
  const { viewW, viewH, style, sizeScale } = input
  const minDim = Math.min(viewW, viewH)
  return {
    targetPx: viewW * TYPESET.targetWidthFrac,
    minPx: minDim * TEXT.minSizeFrac * style.sizeAdjust,
    maxPx: minDim * TYPESET.maxSizeFrac * style.sizeAdjust * sizeScale,
    basePx: minDim * TEXT.baseSizeFrac * style.sizeAdjust * sizeScale,
  }
}

/** Widths per px of font size, including the hierarchy scales. */
function unitWidths(input: LayoutInput): number[] {
  const REF = 100
  return input.words.map(
    (word, i) => (input.measure(word, REF) / REF) * wordScale(i, input.focus),
  )
}

export function layoutCentered(input: LayoutInput): LineLayout {
  if (input.words.length === 0) return { slots: [], fontSize: 0, rows: 0 }
  const sizing = sizingFor(input)
  // Keep the widest row inside the horizontal margins.
  const usable = input.viewW * (1 - 2 * TYPESET.marginX)
  const units = unitWidths(input)
  const { rows, fontSize } = fitLine(
    input.words, units, input.style.wordSpaceFrac, sizing, new Set(),
  )
  const widestU = Math.max(...rows.map((r) => rowWidthU(r, units, input.style.wordSpaceFrac)))
  const size = Math.min(fontSize, usable / Math.max(1e-6, widestU))
  const placed = rows.map((indices) => ({ indices, rowSize: 0 }))
  return { slots: placeRows(input, placed, size), fontSize: size, rows: rows.length }
}

/** Every row scaled to one block width; a focus word gets its own row. */
export function layoutLockup(input: LayoutInput): LineLayout {
  if (input.words.length === 0) return { slots: [], fontSize: 0, rows: 0 }
  const sizing = sizingFor(input)
  const units = unitWidths(input)
  const spaceU = input.style.wordSpaceFrac
  const ownRow = new Set(input.focus.filter((i) => i >= 0 && i < input.words.length))
  const { rows, fontSize } = fitLine(input.words, units, spaceU, sizing, ownRow)
  const blockW = Math.min(
    input.viewW * (1 - 2 * TYPESET.marginX),
    fontSize * Math.max(...rows.map((r) => rowWidthU(r, units, spaceU))),
  )
  // measure is linear in font size, so one unit width per row gives the
  // exact scale to hit the block width.
  const maxRowSize = sizing.maxPx * 1.6
  const placed = rows.map((indices) => {
    const natural = rowWidthU(indices, units, spaceU)
    // The hierarchy scale is baked into the unit widths; divide it back
    // out so slot sizes stay the drawn size.
    const scaleInRow = Math.max(...indices.map((i) => wordScale(i, input.focus)))
    const rowSize = Math.max(
      sizing.minPx,
      Math.min(maxRowSize, (blockW / Math.max(1e-6, natural)) * scaleInRow),
    )
    return { indices, rowSize }
  })
  return {
    slots: placeRows(input, placed, fontSize),
    fontSize,
    rows: rows.length,
  }
}

/** One word at a time, large and centered; one slot per word, same spot. */
export function layoutFocus(input: LayoutInput): LineLayout {
  if (input.words.length === 0) return { slots: [], fontSize: 0, rows: 0 }
  const { words, viewW, viewH, measure, style, sizeScale, focus, anchor } = input
  const minDim = Math.min(viewW, viewH)
  const minSize = minDim * TEXT.minSizeFrac * style.sizeAdjust
  const maxWidth = viewW * 0.8
  const anchorY =
    anchor === 'low' ? TYPESET.lowY : anchor === 'upperLeft' ? TYPESET.upperLeftY + 0.1 : TYPESET.centerY
  const slots: Slot[] = words.map((word, i) => {
    let size =
      minDim * TEXT.baseSizeFrac * sizeScale * 2.2 * style.sizeAdjust * wordScale(i, focus)
    while (measure(word, size) > maxWidth && size > minSize) size *= 0.92
    return {
      text: word,
      index: i,
      x: viewW / 2,
      y: viewH * anchorY,
      w: measure(word, size),
      h: size,
      row: 0,
      focus: focus.includes(i),
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

export const LAYOUTS: Record<LayoutName, (input: LayoutInput) => LineLayout> = {
  centered: layoutCentered,
  lockup: layoutLockup,
  focus: layoutFocus,
}
