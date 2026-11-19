/**
 * Dev-only visual harness. Builds the real scene and mapping from the
 * committed semantics file and steps them with a fixed 1/60 s clock and a
 * scripted AudioFrame track (level follows section energy, steady 120 BPM
 * beat). No audio file needed. scripts/shots.mjs drives it headlessly,
 * screenshots the contact sheet it composes, and fails on the checks in
 * src/thresholds.ts.
 */

import type { AudioFrame } from './audioMath'
import { chooseMotif, NEUTRAL_PARAMS, paramsForSection, type SceneParams } from './mapping'
import { createRandom } from './random'
import { Scene } from './scene'
import {
  activeSectionIndex,
  parseSemantics,
  type Semantics,
  type SemanticSection,
} from './semantics'
import { THRESHOLDS } from './thresholds'

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
  const { motif } = chooseMotif(section?.imagery ?? [])
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

// --- contact sheet -----------------------------------------------------------

function buildSheet(tiles: Tile[], strips: Strip[]): void {
  const sheet = document.getElementById('sheet') as HTMLCanvasElement
  const margin = 12
  const cols = 4
  const labelH = 16
  const tileRows = Math.ceil(tiles.length / cols)
  const width = margin + cols * (TILE_W + margin)
  const stripY = margin + 24 + tileRows * (TILE_H + labelH + margin) + 24
  const height = stripY + strips.length * (STRIP_H + labelH + margin) + margin
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

async function run(): Promise<Report> {
  const response = await fetch('/song/song.semantics.json')
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
    const { motif } = chooseMotif(section.imagery)
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
  buildSheet(tiles, strips)

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
