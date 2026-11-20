/**
 * Dev-only visual harness. Builds the real scene and mapping from the
 * committed semantics file and steps them with a fixed 1/60 s clock and a
 * scripted AudioFrame track (level follows section energy, steady 120 BPM
 * beat). No audio file needed. scripts/shots.mjs drives it headlessly,
 * screenshots the contact sheet it composes, and fails on the checks in
 * src/thresholds.ts.
 */

import '@fontsource/archivo-black'
import '@fontsource/inter/300.css'
import butterchurnModule from 'butterchurn'
import type { AudioFrame } from './audioMath'
import { unwrapButterchurn } from './background'
import { drawDebug } from './debug'
import { GESTURE_NAMES } from './gestures'
import { LAYOUT_NAMES, LAYOUTS, type LayoutName } from './layout'
import { motifForSection, NEUTRAL_PARAMS, paramsForSection, type SceneParams, type TextParams } from './mapping'
import { ENTRANCE_NAMES, EXIT_NAMES, HOLD_NAMES } from './parts'
import { loadAllPresets } from './presetPacks'
import { parseIndex } from './library'
import { CATALOG, feedbackFor, parseFeedbackFile, pickForSections } from './presetPick'
import { createRandom } from './random'
import { Scene } from './scene'
import {
  activeSectionIndex,
  parseSemantics,
  type Semantics,
  type SemanticSection,
} from './semantics'
import { fontGate, TextLayer, type PartOverrides } from './textLayer'
import { THRESHOLDS } from './thresholds'
import { LEGIBILITY, TYPESET } from './tuning'
import {
  loadAllFonts,
  makeMeasure,
  typeStyleFor,
  VOICE_NAMES,
  VOICES,
  type VoiceName,
} from './voices'

const W = 1280
const H = 720
const DT = 1 / 60
const SEED = 42
const BEAT_PERIOD = 0.5 // 120 BPM

interface Check {
  name: string
  pass: boolean
  value: string
  threshold: string
  detail?: string
}

interface Report {
  fatal?: string[]
  checks: Check[]
  tiles: { label: string; motif: string; stddev: number; luminance: number }[]
  pairs: { a: string; b: string; distance: number }[]
  boundaries: { name: string; maxStep: number }[]
  motion: Record<string, number>
  steadyMaxStep: number
  drawMs: { avg: number; p99: number; frames: number }
  drawPerMotif?: Record<string, { avg: number; p99: number }>
  thresholds: typeof THRESHOLDS
}

function scripted(t: number, energy: number, withBeat: boolean): AudioFrame {
  const phase = t % BEAT_PERIOD
  const beat = withBeat ? (phase < DT ? 1 : Math.exp(-5 * phase)) : 0
  return { level: energy, bass: energy, mid: energy * 0.8, high: energy * 0.7, beat }
}

// --- pixel metrics -----------------------------------------------------------

const GRID_W = 32
const GRID_H = 18
const gridCanvas = document.createElement('canvas')
gridCanvas.width = GRID_W
gridCanvas.height = GRID_H
const gridCtx = gridCanvas.getContext('2d', { willReadFrequently: true })!

/** Downscale a render to a 32x18 grid of RGB means. */
function grid(canvas: HTMLCanvasElement): Float32Array {
  gridCtx.drawImage(canvas, 0, 0, GRID_W, GRID_H)
  const data = gridCtx.getImageData(0, 0, GRID_W, GRID_H).data
  const out = new Float32Array(GRID_W * GRID_H * 3)
  for (let i = 0, j = 0; i < data.length; i += 4) {
    out[j++] = data[i]
    out[j++] = data[i + 1]
    out[j++] = data[i + 2]
  }
  return out
}

const COARSE_W = 8
const COARSE_H = 5
const coarseCanvas = document.createElement('canvas')
coarseCanvas.width = COARSE_W
coarseCanvas.height = COARSE_H
const coarseCtx = coarseCanvas.getContext('2d', { willReadFrequently: true })!

/**
 * A position-insensitive 8x5 grid: individual particles average out, so
 * two renders of the same look with different particle histories compare
 * as equal. Used for the "same look" checks (neutral toggle).
 */
function coarseGrid(canvas: HTMLCanvasElement): Float32Array {
  coarseCtx.drawImage(canvas, 0, 0, COARSE_W, COARSE_H)
  const data = coarseCtx.getImageData(0, 0, COARSE_W, COARSE_H).data
  const out = new Float32Array(COARSE_W * COARSE_H * 3)
  for (let i = 0, j = 0; i < data.length; i += 4) {
    out[j++] = data[i]
    out[j++] = data[i + 1]
    out[j++] = data[i + 2]
  }
  return out
}

/** Mean absolute RGB difference between two grids (0..255). */
function gridDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

function luminanceStats(g: Float32Array): { mean: number; stddev: number } {
  const n = g.length / 3
  let sum = 0
  let sumSq = 0
  for (let i = 0; i < g.length; i += 3) {
    const lum = 0.2126 * g[i] + 0.7152 * g[i + 1] + 0.0722 * g[i + 2]
    sum += lum
    sumSq += lum * lum
  }
  const mean = sum / n
  return { mean, stddev: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) }
}

function snapshot(canvas: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const copy = document.createElement('canvas')
  copy.width = w
  copy.height = h
  copy.getContext('2d')!.drawImage(canvas, 0, 0, w, h)
  return copy
}

// --- simulation --------------------------------------------------------------

class Sim {
  readonly canvas = document.createElement('canvas')
  readonly scene: Scene
  t = 0
  readonly drawTimes: number[] = []

  constructor() {
    this.scene = new Scene(this.canvas, createRandom(SEED))
    this.scene.resize(W, H, 1)
  }

  step(target: SceneParams, energy: number, withBeat = true): void {
    const frame = scripted(this.t, energy, withBeat)
    const start = performance.now()
    this.scene.draw(frame, target, DT)
    this.drawTimes.push(performance.now() - start)
    this.t += DT
  }

  run(seconds: number, target: SceneParams, energy: number, withBeat = true): void {
    const n = Math.round(seconds / DT)
    for (let i = 0; i < n; i++) this.step(target, energy, withBeat)
  }
}

function timelineTarget(
  semantics: Semantics,
  t: number,
): { target: SceneParams; energy: number } {
  const index = activeSectionIndex(semantics.sections, t)
  const section = index >= 0 ? semantics.sections[index] : null
  return {
    target: section ? paramsForSection(section, 0.5) : NEUTRAL_PARAMS,
    energy: section?.energy ?? 0.5,
  }
}

// --- scenarios ---------------------------------------------------------------

const TILE_SETTLE_SEC = 6
const TILE_W = 320
const TILE_H = 180
const STRIP_W = 158
const STRIP_H = 89
/** Capture offsets (s) around a boundary for the 8-frame filmstrip. */
const STRIP_OFFSETS = [-0.3, 0.05, 0.2, 0.4, 0.7, 1.1, 1.7, 2.5]
const STRIP_TAIL = 3.0

interface Tile {
  label: string
  motif: string
  mood: string
  snap: HTMLCanvasElement
  grid: Float32Array
  coarse: Float32Array
  stats: { mean: number; stddev: number }
  /** Largest single-frame change during the steady tail (jump baseline). */
  steadyMaxStep: number
  /** Draw times from the settle phase only (no readbacks interleaved). */
  drawTimes: number[]
}

function renderTile(section: SemanticSection | null): Tile {
  const sim = new Sim()
  const target = section ? paramsForSection(section, 0.5) : NEUTRAL_PARAMS
  const energy = section?.energy ?? 0.5
  sim.run(TILE_SETTLE_SEC - 2, target, energy)
  // Draw timing from the settle phase only: the measuring tail interleaves
  // getImageData readbacks, which stall the rasterizer and poison timings.
  const drawTimes = sim.drawTimes.slice()
  // Steady tail: measure the per-frame change baseline.
  let prev = grid(sim.canvas)
  let steadyMaxStep = 0
  for (let i = 0; i < Math.round(2 / DT); i++) {
    sim.step(target, energy)
    const g = grid(sim.canvas)
    steadyMaxStep = Math.max(steadyMaxStep, gridDistance(prev, g))
    prev = g
  }
  const { motif } = motifForSection(section)
  return {
    label: section ? section.label : 'neutral (S off)',
    motif: section ? motif : 'drift',
    mood: section?.mood ?? '—',
    snap: snapshot(sim.canvas, TILE_W, TILE_H),
    grid: prev,
    coarse: coarseGrid(sim.canvas),
    stats: luminanceStats(prev),
    steadyMaxStep,
    drawTimes,
  }
}

interface Strip {
  name: string
  frames: HTMLCanvasElement[]
  maxStep: number
}

function renderStrip(semantics: Semantics, boundary: number, name: string): Strip {
  const sim = new Sim()
  sim.t = boundary - 2
  sim.scene.notifySeek()
  const frames: HTMLCanvasElement[] = []
  let prev: Float32Array | null = null
  let maxStep = 0
  let nextOffset = 0
  const end = boundary + STRIP_TAIL
  while (sim.t < end) {
    const { target, energy } = timelineTarget(semantics, sim.t)
    sim.step(target, energy)
    const offset = sim.t - boundary
    if (nextOffset < STRIP_OFFSETS.length && offset >= STRIP_OFFSETS[nextOffset]) {
      frames.push(snapshot(sim.canvas, STRIP_W, STRIP_H))
      nextOffset++
    }
    // Jump detection across the whole transition window.
    if (offset >= -0.1) {
      const g = grid(sim.canvas)
      if (prev) maxStep = Math.max(maxStep, gridDistance(prev, g))
      prev = g
    }
  }
  return { name, frames, maxStep }
}

function motionProbe(level: number): number {
  const sim = new Sim()
  sim.run(2.5, NEUTRAL_PARAMS, level, false)
  let prev = grid(sim.canvas)
  let sum = 0
  const n = Math.round(1.5 / DT)
  for (let i = 0; i < n; i++) {
    sim.step(NEUTRAL_PARAMS, level, false)
    const g = grid(sim.canvas)
    sum += gridDistance(prev, g)
    prev = g
  }
  return sum / n
}

/**
 * Honest per-frame draw cost for one look: forces rasterization each frame
 * (a 1x1 readback), because the headless canvas otherwise batches many
 * frames of work and bills it all to one. First frames are skipped to
 * exclude one-time allocations.
 */
function drawTimeProbe(section: SemanticSection | null): { avg: number; p99: number } {
  const sim = new Sim()
  const target = section ? paramsForSection(section, 0.5) : NEUTRAL_PARAMS
  const energy = section?.energy ?? 0.5
  sim.run(1.5, target, energy)
  const ctx = sim.canvas.getContext('2d')!
  const times: number[] = []
  for (let i = 0; i < 120; i++) {
    const start = performance.now()
    sim.step(target, energy)
    ctx.getImageData(0, 0, 1, 1)
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  return {
    avg: times.reduce((a, b) => a + b, 0) / times.length,
    p99: times[Math.floor(times.length * 0.99)],
  }
}

/** Mean RGB of a grid: a position-independent color signature. */
function meanColor(g: Float32Array): [number, number, number] {
  let r = 0
  let gr = 0
  let b = 0
  const n = g.length / 3
  for (let i = 0; i < g.length; i += 3) {
    r += g[i]
    gr += g[i + 1]
    b += g[i + 2]
  }
  return [r / n, gr / n, b / n]
}

/**
 * Lock onto the climax, toggle semantics off, settle: the scene must
 * commit to the neutral params, and the overall color signature must
 * match the neutral look. (A spatial compare would only see particle
 * position and breath-phase differences between the two histories.)
 */
function neutralToggle(semantics: Semantics): {
  state: { key: string; incoming: string | null; pending: string | null }
  mean: [number, number, number]
} {
  const climax = semantics.sections.reduce((a, b) => (b.energy > a.energy ? b : a))
  const sim = new Sim()
  sim.run(4, paramsForSection(climax, 0.5), climax.energy)
  sim.run(8, NEUTRAL_PARAMS, 0.5)
  return { state: sim.scene.transitionState, mean: meanColor(grid(sim.canvas)) }
}

// --- kinetic typography scenarios --------------------------------------------

/** Made-up lines only; lyric text never enters the repo. */
const FAKE_LINE_A = 'FAKE KINETIC WORDS HERE'
const FAKE_LINE_B = 'SECOND SYNTH LINE'

function fakeTextParams(emphasis: number): TextParams {
  return {
    voice: 'block',
    entrance: 'slam',
    hold: 'still',
    exit: 'blow',
    layout: 'centered',
    anchor: 'center',
    focus: [],
    gestures: [],
    fill: [235, 240, 250],
    accent: [255, 180, 90],
    tint: [60, 80, 140],
    forceScale: 1.2,
    sizeScale: 1,
    scrim: 0.3,
    emphasis,
  }
}

interface TextStrip {
  name: string
  frames: HTMLCanvasElement[]
}

/** Snapshot the (transparent) text canvas composited over black. */
function snapText(canvas: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const copy = document.createElement('canvas')
  copy.width = w
  copy.height = h
  const ctx = copy.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(canvas, 0, 0, w, h)
  return copy
}

interface TextSimResult {
  frames: HTMLCanvasElement[]
  worstTilt: number
  /** px beyond the slot tolerance (0 = inside). */
  worstOver: number
  offscreen: number
  overlap: number
  lineViolations: number
}

/**
 * Run two made-up lines through a part combination, measuring the hard
 * legibility rules by introspection: settled, non-exiting words (and
 * their letters) upright within the tilt limit, near their slot, on
 * screen; visible rest boxes never overlapping; at most two lines
 * around. With render=false nothing is drawn, so the full combination
 * space can be swept cheaply.
 */
function runTextSim(
  overrides: PartOverrides,
  emphasis: number,
  render: boolean,
  captureAt: number[],
  switchAt = 2.4,
  total = 3.4,
  extra: Partial<TextParams> = {},
): TextSimResult {
  const canvas = document.createElement('canvas')
  const layer = new TextLayer(canvas, createRandom(SEED))
  layer.resize(W, H, 1)
  const params = { ...fakeTextParams(emphasis), ...extra }
  const lineA = { index: 0, text: FAKE_LINE_A, start: 0, end: switchAt }
  const lineB = { index: 1, text: FAKE_LINE_B, start: switchAt, end: switchAt * 2 }
  const result: TextSimResult = {
    frames: [],
    worstTilt: 0,
    worstOver: 0,
    offscreen: 0,
    overlap: 0,
    lineViolations: 0,
  }
  const settledProbe = switchAt * 0.8
  let nextCapture = 0
  const steps = Math.round(total / DT)
  for (let i = 0; i < steps; i++) {
    const t = i * DT
    layer.draw(
      scripted(t, 0.6, true),
      { params, line: t < switchAt ? lineA : lineB, time: t, overrides },
      DT,
      render,
    )
    if (render && nextCapture < captureAt.length && t >= captureAt[nextCapture]) {
      result.frames.push(snapText(canvas, 240, 135))
      nextCapture++
    }

    const state = layer.inspect()
    if (state.lineCount > 2) result.lineViolations++
    const visible = state.words.filter((word) => word.entered && !word.exiting)
    for (const word of visible) {
      if (t < word.onset + LEGIBILITY.settleSec + DT) continue
      result.worstTilt = Math.max(
        result.worstTilt,
        Math.abs(word.rotDeg),
        word.letterMaxTiltDeg,
      )
      const dist = Math.hypot(word.xPx - word.slotXPx, word.yPx - word.slotYPx)
      const tol = LEGIBILITY.slotTolFrac * word.fontSize
      result.worstOver = Math.max(
        result.worstOver,
        dist - tol,
        word.letterMaxOffsetPx - tol,
      )
      const eps = THRESHOLDS.legibilityEpsPx
      if (
        word.xPx - word.wPx / 2 < -eps ||
        word.xPx + word.wPx / 2 > W + eps ||
        word.yPx - word.hPx < -eps ||
        word.yPx + word.hPx > H + eps
      ) {
        result.offscreen++
      }
    }
    // Visible rest boxes must not overlap (sampled once, settled).
    if (Math.abs(t - settledProbe) < DT) {
      for (let a = 0; a < visible.length; a++) {
        for (let b = a + 1; b < visible.length; b++) {
          const dx = Math.abs(visible[a].slotXPx - visible[b].slotXPx)
          const dy = Math.abs(visible[a].slotYPx - visible[b].slotYPx)
          if (
            dx < ((visible[a].wPx + visible[b].wPx) / 2) * 0.98 &&
            dy < ((visible[a].hPx + visible[b].hPx) / 2) * 0.98
          ) {
            result.overlap++
          }
        }
      }
    }
  }
  return result
}

/** Sweep every entrance x hold x exit combination without drawing. */
function sweepCombinations(): Check[] {
  let worstTilt = 0
  let worstTiltCombo = ''
  let worstOver = 0
  let worstOverCombo = ''
  let offscreen = 0
  let overlap = 0
  let lineViolations = 0
  let combos = 0
  for (const entrance of ENTRANCE_NAMES) {
    for (const hold of HOLD_NAMES) {
      for (const exit of EXIT_NAMES) {
        combos++
        const r = runTextSim({ entrance, hold, exit }, 0.6, false, [], 1.6, 2.6)
        if (r.worstTilt > worstTilt) {
          worstTilt = r.worstTilt
          worstTiltCombo = `${entrance}/${hold}/${exit}`
        }
        if (r.worstOver > worstOver) {
          worstOver = r.worstOver
          worstOverCombo = `${entrance}/${hold}/${exit}`
        }
        offscreen += r.offscreen
        overlap += r.overlap
        lineViolations += r.lineViolations
      }
    }
  }
  return [
    {
      name: `combos settle legible (${combos} entrance x hold x exit)`,
      pass:
        worstTilt <= LEGIBILITY.maxTiltDeg + THRESHOLDS.legibilityEpsDeg &&
        worstOver <= THRESHOLDS.legibilityEpsPx &&
        offscreen === 0,
      value: `tilt ${worstTilt.toFixed(1)}° (${worstTiltCombo}), overshoot ${worstOver.toFixed(1)}px (${worstOverCombo}), offscreen ${offscreen}`,
      threshold: `tilt <= ${LEGIBILITY.maxTiltDeg}°, within ${LEGIBILITY.slotTolFrac}x font of the slot, on screen`,
    },
    {
      name: 'combos keep rest boxes apart and lines <= 2',
      pass: overlap === 0 && lineViolations === 0,
      value: `overlaps ${overlap}, line-count violations ${lineViolations}`,
      threshold: '0 and 0',
    },
  ]
}

// --- typesetting checks ------------------------------------------------------

/** Made-up lines only; lyric text never enters the repo. */
const SPECIMEN_LINE = 'FAKE KINETIC WORDS HERE'
const WRAP_LINE = 'invented words keep marching over the bright, empty screen tonight'

/**
 * Measure the layouts directly with the real fonts: word gaps equal the
 * voice's word space, slots stay inside the margins, wrapped rows are
 * balanced with no orphan last row.
 */
function typesetChecks(): Check[] {
  const ctx = document.createElement('canvas').getContext('2d')!
  let worstGap = 0
  let worstGapWhere = ''
  let worstMargin = 0
  let worstMarginWhere = ''
  let worstBalance = 1
  let worstBalanceWhere = ''
  let orphans = 0
  let wrapped = 0

  const layoutFor = (voice: VoiceName, layout: LayoutName, text: string) => {
    const caps = VOICES[voice].caps
    const words = text.split(/\s+/).map((word) => (caps ? word.toUpperCase() : word))
    return LAYOUTS[layout]({
      words,
      viewW: W,
      viewH: H,
      measure: makeMeasure(ctx, voice),
      style: typeStyleFor(ctx, voice),
      sizeScale: 1,
      focus: [],
      anchor: 'center',
    })
  }

  for (const voice of VOICE_NAMES) {
    const style = typeStyleFor(ctx, voice)
    for (const layout of ['centered', 'lockup'] as LayoutName[]) {
      const { slots } = layoutFor(voice, layout, SPECIMEN_LINE)
      for (let i = 1; i < slots.length; i++) {
        const a = slots[i - 1]
        const b = slots[i]
        if (a.row !== b.row) continue
        const gap = b.x - b.w / 2 - (a.x + a.w / 2)
        const err = Math.abs(gap - style.wordSpaceFrac * a.h)
        if (err > worstGap) {
          worstGap = err
          worstGapWhere = `${voice}/${layout}`
        }
      }
      for (const slot of slots) {
        const over = Math.max(
          W * TYPESET.marginX - (slot.x - slot.w / 2),
          slot.x + slot.w / 2 - W * (1 - TYPESET.marginX),
          H * TYPESET.marginTop - (slot.y - slot.h * 0.45),
          slot.y + slot.h * 0.6 - H * (1 - TYPESET.marginBottom),
        )
        if (over > worstMargin) {
          worstMargin = over
          worstMarginWhere = `${voice}/${layout}`
        }
      }
    }
    const { slots, rows } = layoutFor(voice, 'centered', WRAP_LINE)
    if (rows >= 2) {
      wrapped++
      const widths: number[] = []
      const counts: number[] = []
      for (let r = 0; r < rows; r++) {
        const rowSlots = slots.filter((slot) => slot.row === r)
        counts.push(rowSlots.length)
        const first = rowSlots[0]
        const last = rowSlots[rowSlots.length - 1]
        widths.push(last.x + last.w / 2 - (first.x - first.w / 2))
      }
      const widest = Math.max(...widths)
      const ratio = Math.min(...widths) / widest
      if (ratio < worstBalance) {
        worstBalance = ratio
        worstBalanceWhere = voice
      }
      if (counts[rows - 1] === 1 && widths[rows - 1] < TYPESET.orphanFrac * widest) orphans++
    }
  }

  const T = THRESHOLDS
  return [
    {
      name: 'specimen word gaps match each voice word space',
      pass: worstGap <= T.wordGapEpsPx,
      value: `worst ${worstGap.toFixed(2)}px (${worstGapWhere})`,
      threshold: `<= ${T.wordGapEpsPx}px`,
    },
    {
      name: 'specimen slots stay inside the safe margins',
      pass: worstMargin <= T.marginEpsPx,
      value: `worst overrun ${worstMargin.toFixed(2)}px (${worstMarginWhere})`,
      threshold: `<= ${T.marginEpsPx}px`,
    },
    {
      name: `wrapped rows balanced, no orphans (${wrapped} voices wrap)`,
      pass: wrapped > 0 && worstBalance >= T.rowBalanceMin && orphans === 0,
      value: `worst balance ${worstBalance.toFixed(2)} (${worstBalanceWhere}), orphans ${orphans}`,
      threshold: `balance >= ${T.rowBalanceMin}, 0 orphans`,
    },
  ]
}

/** The overlay must render identically on a deliberately polluted ctx. */
function debugOverlayCheck(): Check {
  const render = (pollute: boolean): ImageData => {
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 260
    const ctx = canvas.getContext('2d')! as CanvasRenderingContext2D & {
      letterSpacing: string
      wordSpacing: string
    }
    if (pollute) {
      ctx.font = 'italic 64px serif'
      ctx.letterSpacing = '24px'
      ctx.wordSpacing = '31px'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'bottom'
      ctx.globalAlpha = 0.35
      ctx.globalCompositeOperation = 'lighter'
      ctx.shadowColor = '#f00'
      ctx.shadowBlur = 12
      ctx.shadowOffsetX = 6
      ctx.fillStyle = '#123456'
      ctx.lineWidth = 9
      ctx.direction = 'rtl'
    }
    drawDebug(
      ctx,
      { level: 0.5, bass: 0.7, mid: 0.4, high: 0.3, beat: 1 },
      ['made-up status line for width', 'wide WWWW thin iiii 0.00'],
    )
    return ctx.getImageData(0, 0, 600, 260)
  }
  const clean = render(false)
  const polluted = render(true)
  let maxDiff = 0
  for (let i = 0; i < clean.data.length; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(clean.data[i] - polluted.data[i]))
  }
  return {
    name: 'debug overlay immune to inherited canvas state',
    pass: maxDiff <= THRESHOLDS.debugOverlayMaxDiff,
    value: `max channel diff ${maxDiff}`,
    threshold: `<= ${THRESHOLDS.debugOverlayMaxDiff}`,
  }
}

/** Butterchurn smoke: with an oscillator source, frames are not blank. */
async function butterchurnSmoke(): Promise<Check> {
  const name = 'butterchurn smoke (oscillator)'
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 144
  if (!canvas.getContext('webgl2')) {
    return {
      name,
      pass: true,
      value: 'SKIPPED with warning: headless browser lacks WebGL 2',
      threshold: `stddev >= ${THRESHOLDS.butterchurnMinStdDev}`,
    }
  }
  try {
    const context = new AudioContext()
    try {
      await context.resume()
    } catch {
      // stays suspended: render still runs, audio reads as silence
    }
    const osc = context.createOscillator()
    const gain = context.createGain()
    gain.gain.value = 0.6
    osc.type = 'sawtooth'
    osc.frequency.value = 110
    osc.connect(gain) // deliberately not to the destination: silent
    osc.start()
    const visualizer = unwrapButterchurn(butterchurnModule).createVisualizer(context, canvas, {
      width: 256,
      height: 144,
    })
    visualizer.connectAudio(gain)
    const presets = await loadAllPresets()
    visualizer.loadPreset(Object.values(presets)[0], 0)
    for (let i = 0; i < 70; i++) {
      visualizer.render()
      await new Promise((resolve) => setTimeout(resolve, 15))
    }
    const copy = document.createElement('canvas')
    copy.width = 64
    copy.height = 36
    const ctx = copy.getContext('2d')!
    ctx.drawImage(canvas, 0, 0, 64, 36)
    const data = ctx.getImageData(0, 0, 64, 36).data
    let sum = 0
    let sumSq = 0
    const n = data.length / 4
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      sum += lum
      sumSq += lum * lum
    }
    const mean = sum / n
    const stddev = Math.sqrt(Math.max(0, sumSq / n - mean * mean))
    osc.stop()
    await context.close()
    return {
      name,
      pass: stddev >= THRESHOLDS.butterchurnMinStdDev,
      value: `stddev ${stddev.toFixed(2)}`,
      threshold: `>= ${THRESHOLDS.butterchurnMinStdDev}`,
    }
  } catch (error) {
    return { name, pass: false, value: String(error), threshold: 'renders without throwing' }
  }
}

// --- contact sheet -----------------------------------------------------------

function buildSheet(
  tiles: Tile[],
  strips: Strip[],
  textStrips: TextStrip[],
  pickLines: string[],
): void {
  const sheet = document.getElementById('sheet') as HTMLCanvasElement
  const margin = 12
  const cols = 4
  const labelH = 16
  const TEXT_W = 240
  const TEXT_H = 135
  const tileRows = Math.ceil(tiles.length / cols)
  const width = margin + cols * (TILE_W + margin)
  const stripY = margin + 24 + tileRows * (TILE_H + labelH + margin) + 24
  const textY = stripY + strips.length * (STRIP_H + labelH + margin) + 24
  const picksY = textY + textStrips.length * (TEXT_H + labelH + margin) + 24
  const height = picksY + pickLines.length * 16 + margin * 2
  sheet.width = width
  sheet.height = height
  const ctx = sheet.getContext('2d')!
  ctx.fillStyle = '#16181d'
  ctx.fillRect(0, 0, width, height)
  ctx.font = '12px monospace'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#cfd6e4'
  ctx.fillText(`section tiles (${TILE_SETTLE_SEC}s settle, scripted audio, seed ${SEED})`, margin, margin)

  tiles.forEach((tile, i) => {
    const x = margin + (i % cols) * (TILE_W + margin)
    const y = margin + 24 + Math.floor(i / cols) * (TILE_H + labelH + margin)
    ctx.drawImage(tile.snap, x, y)
    ctx.fillStyle = '#cfd6e4'
    ctx.fillText(`${tile.label} · ${tile.motif} · ${tile.mood}`, x, y + TILE_H + 3)
  })

  ctx.fillStyle = '#cfd6e4'
  ctx.fillText('boundary filmstrips (offsets s: ' + STRIP_OFFSETS.join(', ') + ')', margin, stripY - 20)
  strips.forEach((strip, i) => {
    const y = stripY + i * (STRIP_H + labelH + margin)
    strip.frames.forEach((frame, j) => {
      ctx.drawImage(frame, margin + j * (STRIP_W + 4), y)
    })
    ctx.fillStyle = '#cfd6e4'
    ctx.fillText(`${strip.name} · max frame step ${strip.maxStep.toFixed(2)}`, margin, y + STRIP_H + 3)
  })

  ctx.fillStyle = '#cfd6e4'
  ctx.fillText('kinetic typography (made-up lines, black background)', margin, textY - 20)
  textStrips.forEach((strip, i) => {
    const y = textY + i * (TEXT_H + labelH + margin)
    strip.frames.forEach((frame, j) => {
      ctx.drawImage(frame, margin + j * (TEXT_W + 6), y)
    })
    ctx.fillStyle = '#cfd6e4'
    ctx.fillText(strip.name, margin, y + TEXT_H + 3)
  })

  ctx.fillStyle = '#cfd6e4'
  ctx.fillText('background preset picks per section', margin, picksY - 20)
  pickLines.forEach((line, i) => {
    ctx.fillText(line, margin, picksY + i * 16)
  })
}

// --- checks ------------------------------------------------------------------

function runChecks(
  tiles: Tile[],
  strips: Strip[],
  motion: Record<string, number>,
  neutralDistance: number,
  toggleCommitted: boolean,
  steadyMaxStep: number,
  drawMs: { avg: number; p99: number },
): { checks: Check[]; pairs: { a: string; b: string; distance: number }[] } {
  const checks: Check[] = []
  const T = THRESHOLDS

  for (const tile of tiles) {
    checks.push({
      name: `tile not blank: ${tile.label}`,
      pass: tile.stats.stddev >= T.minTileStdDev && tile.stats.mean >= T.minTileLuminance,
      value: `stddev ${tile.stats.stddev.toFixed(1)}, lum ${tile.stats.mean.toFixed(1)}`,
      threshold: `stddev >= ${T.minTileStdDev}, lum >= ${T.minTileLuminance}`,
    })
  }

  const pairs: { a: string; b: string; distance: number }[] = []
  const sectionTiles = tiles.filter((t) => !t.label.startsWith('neutral'))
  for (let i = 0; i < sectionTiles.length; i++) {
    for (let j = i + 1; j < sectionTiles.length; j++) {
      const a = sectionTiles[i]
      const b = sectionTiles[j]
      const distance = gridDistance(a.grid, b.grid)
      pairs.push({ a: a.label, b: b.label, distance })
      if (a.label === b.label) {
        checks.push({
          name: `repeats match: ${a.label}`,
          pass: distance <= T.maxSameLabelDistance,
          value: distance.toFixed(3),
          threshold: `<= ${T.maxSameLabelDistance}`,
        })
      } else {
        checks.push({
          name: `distinct: ${a.label} vs ${b.label}`,
          pass: distance >= T.minSectionDistance,
          value: distance.toFixed(2),
          threshold: `>= ${T.minSectionDistance}`,
        })
      }
    }
  }

  checks.push({
    name: 'semantics off commits to the neutral params',
    pass: toggleCommitted,
    value: toggleCommitted ? 'committed' : 'stuck in transition',
    threshold: 'committed, nothing pending',
  })
  checks.push({
    name: 'semantics off matches the neutral color signature',
    pass: neutralDistance <= T.maxNeutralDistance,
    value: neutralDistance.toFixed(2),
    threshold: `<= ${T.maxNeutralDistance}`,
  })

  checks.push({
    name: 'idle still moves at level 0',
    pass: motion['0'] >= T.idleMotionMin,
    value: motion['0'].toFixed(3),
    threshold: `>= ${T.idleMotionMin}`,
  })
  checks.push({
    name: 'motion rises with level',
    pass:
      motion['1'] >= motion['0.35'] * T.motionRiseFactor && motion['0.35'] > motion['0'],
    value: `0: ${motion['0'].toFixed(3)}, 0.35: ${motion['0.35'].toFixed(3)}, 1: ${motion['1'].toFixed(3)}`,
    threshold: `m(1) >= ${T.motionRiseFactor} * m(0.35), m(0.35) > m(0)`,
  })

  const jumpLimit = steadyMaxStep * T.jumpFactor
  for (const strip of strips) {
    checks.push({
      name: `no frame jump: ${strip.name}`,
      pass: strip.maxStep <= jumpLimit,
      value: strip.maxStep.toFixed(2),
      threshold: `<= ${jumpLimit.toFixed(2)} (steady ${steadyMaxStep.toFixed(2)} x ${T.jumpFactor})`,
    })
  }

  checks.push({
    name: 'draw time within budget (worst motif)',
    pass: drawMs.avg <= T.drawAvgMs && drawMs.p99 <= T.drawP99Ms,
    value: `avg ${drawMs.avg.toFixed(2)}ms, p99 ${drawMs.p99.toFixed(2)}ms`,
    threshold: `avg <= ${T.drawAvgMs}ms, p99 <= ${T.drawP99Ms}ms`,
  })

  return { checks, pairs }
}

// --- entry point -------------------------------------------------------------

/**
 * The semantics the harness renders: the first library song's, or the
 * generated fixture's when the library is empty (so the checks run on any
 * machine, with zero, one or many songs present).
 */
async function harnessSong(): Promise<{ slug: string; base: string }> {
  try {
    const response = await fetch('/songs/index.json')
    if (response.ok) {
      const entries = parseIndex((await response.json()) as unknown)
      if (entries[0]) return { slug: entries[0].slug, base: entries[0].base }
    }
  } catch {
    // fall through to the fixture
  }
  return { slug: 'fixture-a', base: '/fixture/fixture-a/' }
}

async function run(): Promise<Report> {
  const { slug, base } = await harnessSong()
  const response = await fetch(base + 'semantics.json')
  const { semantics, errors } = parseSemantics(await response.json())
  if (!semantics) {
    return {
      fatal: errors,
      checks: [],
      tiles: [],
      pairs: [],
      boundaries: [],
      motion: {},
      steadyMaxStep: 0,
      drawMs: { avg: 0, p99: 0, frames: 0 },
      thresholds: THRESHOLDS,
    }
  }

  const tiles = [
    ...semantics.sections.map((section) => renderTile(section)),
    renderTile(null),
  ]

  const strips: Strip[] = []
  for (let i = 1; i < semantics.sections.length; i++) {
    const prev = semantics.sections[i - 1]
    const next = semantics.sections[i]
    strips.push(
      renderStrip(semantics, next.start, `${prev.label} -> ${next.label} @ ${next.start}s`),
    )
  }

  const motion: Record<string, number> = {}
  for (const level of [0, 0.35, 0.7, 1]) motion[String(level)] = motionProbe(level)

  const toggle = neutralToggle(semantics)
  // Reference: a fresh neutral run of the same total duration, so the
  // breath and beat phases line up with the toggle run at capture.
  const freshNeutral = new Sim()
  freshNeutral.run(12, NEUTRAL_PARAMS, 0.5)
  const neutralMean = meanColor(grid(freshNeutral.canvas))
  const neutralDistance =
    (Math.abs(toggle.mean[0] - neutralMean[0]) +
      Math.abs(toggle.mean[1] - neutralMean[1]) +
      Math.abs(toggle.mean[2] - neutralMean[2])) /
    3
  const toggleCommitted =
    toggle.state.key === 'neutral' && toggle.state.incoming === null && toggle.state.pending === null

  const steadyMaxStep = Math.max(...tiles.map((t) => t.steadyMaxStep))

  // One draw-time probe per motif, on the section that uses it.
  const motifSections = new Map<string, SemanticSection | null>([['drift', null]])
  for (const section of semantics.sections) {
    const { motif } = motifForSection(section)
    if (!motifSections.has(motif)) motifSections.set(motif, section)
  }
  const drawPerMotif: Record<string, { avg: number; p99: number }> = {}
  for (const [motif, section] of motifSections) {
    const probe = drawTimeProbe(section)
    drawPerMotif[motif] = { avg: Number(probe.avg.toFixed(3)), p99: Number(probe.p99.toFixed(3)) }
  }
  const drawMs = {
    avg: Math.max(...Object.values(drawPerMotif).map((d) => d.avg)),
    p99: Math.max(...Object.values(drawPerMotif).map((d) => d.p99)),
    frames: 120 * motifSections.size,
  }

  const { checks, pairs } = runChecks(
    tiles,
    strips,
    motion,
    neutralDistance,
    toggleCommitted,
    steadyMaxStep,
    drawMs,
  )

  // Kinetic typography: ctx.font alone never triggers CSS font loading,
  // so request every face, then film each part, voice and layout.
  await loadAllFonts()
  await document.fonts.ready
  const textStrips: TextStrip[] = []
  const film = (
    name: string,
    overrides: PartOverrides,
    captureAt: number[],
    emphasis = 0.6,
    extra: Partial<TextParams> = {},
  ) => {
    const r = runTextSim(overrides, emphasis, true, captureAt, 2.4, 3.4, extra)
    textStrips.push({ name, frames: r.frames })
    return r
  }
  // The type specimen: every voice x every layout on the same made-up
  // line, with a focus word to show the hierarchy.
  for (const voice of VOICE_NAMES) {
    const frames: HTMLCanvasElement[] = []
    for (const layout of LAYOUT_NAMES) {
      const r = runTextSim(
        { entrance: 'creep', hold: 'still', exit: 'blow', voice, layout },
        0.6,
        true,
        [1.6],
        2.4,
        2.0,
        { focus: [2] },
      )
      frames.push(...r.frames)
    }
    textStrips.push({ name: `specimen: ${voice} (centered · lockup · focus)`, frames })
  }
  for (const entrance of ENTRANCE_NAMES) {
    film(`entrance: ${entrance}`, { entrance, hold: 'still', exit: 'blow' }, [0.12, 0.4, 1.9])
  }
  for (const hold of HOLD_NAMES) {
    film(`hold: ${hold}`, { entrance: 'creep', hold, exit: 'blow' }, [1.0, 1.6, 2.2])
  }
  for (const exit of EXIT_NAMES) {
    film(`exit: ${exit}`, { entrance: 'creep', hold: 'still', exit }, [2.45, 2.62, 2.85])
  }
  for (const voice of VOICE_NAMES) {
    film(`voice: ${voice}`, { entrance: 'creep', hold: 'still', exit: 'blow', voice }, [0.4, 1.9, 2.5])
  }
  for (const layout of LAYOUT_NAMES) {
    film(`layout: ${layout}`, { entrance: 'creep', hold: 'still', exit: 'blow', layout }, [0.6, 1.3, 1.9])
  }
  // One filmstrip per gesture, performed by word 2 of the made-up line.
  for (const gesture of GESTURE_NAMES) {
    film(
      `gesture: ${gesture}`,
      { entrance: 'creep', hold: 'still', exit: 'blow' },
      [1.0, 1.7, 2.6],
      0.6,
      { focus: [2], gestures: [{ index: 2, gesture, dir: null, source: 'direction' }] },
    )
  }

  checks.push(...sweepCombinations())
  checks.push(...typesetChecks())
  checks.push(debugOverlayCheck())
  checks.push({
    name: 'no text drawn before fonts were ready',
    pass: fontGate.violations === 0,
    value: String(fontGate.violations),
    threshold: '0 glyphs',
  })
  checks.push(await butterchurnSmoke())

  // The chosen background preset per section of the song.
  const feedbackFile = parseFeedbackFile((await import('./presetFeedback.json')).default)
  const picks = pickForSections(
    semantics.sections,
    feedbackFor(feedbackFile, slug),
    CATALOG,
    semantics.look ?? null,
  )
  const pickLines: string[] = []
  for (const pick of picks.values()) {
    if (!pick.chosen) {
      pickLines.push(`${pick.label.padEnd(11)} -> (no usable preset)`)
      continue
    }
    const entry = CATALOG[pick.chosen]
    pickLines.push(
      `${pick.label.padEnd(11)} -> ${pick.chosen.slice(0, 52)}${pick.source === 'saved' ? '  [saved]' : pick.source === 'look' ? '  [look]' : ''}  (${pick.reasons.join(', ')})`,
    )
    pickLines.push(`${''.padEnd(11)}    "${entry?.description ?? ''}"`.slice(0, 120))
  }
  if (pickLines.length === 0) pickLines.push('(catalog empty)')

  buildSheet(tiles, strips, textStrips, pickLines)

  return {
    checks,
    tiles: tiles.map((t) => ({
      label: t.label,
      motif: t.motif,
      stddev: Number(t.stats.stddev.toFixed(2)),
      luminance: Number(t.stats.mean.toFixed(2)),
    })),
    pairs: pairs.map((p) => ({ ...p, distance: Number(p.distance.toFixed(3)) })),
    boundaries: strips.map((s) => ({ name: s.name, maxStep: Number(s.maxStep.toFixed(3)) })),
    motion,
    steadyMaxStep: Number(steadyMaxStep.toFixed(3)),
    drawMs: {
      avg: Number(drawMs.avg.toFixed(3)),
      p99: Number(drawMs.p99.toFixed(3)),
      frames: drawMs.frames,
    },
    drawPerMotif,
    thresholds: THRESHOLDS,
  }
}

declare global {
  interface Window {
    __harness: { run: () => Promise<Report> }
    __ready: boolean
  }
}

window.__harness = { run }
window.__ready = true
