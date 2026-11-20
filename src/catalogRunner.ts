/**
 * Dev-only page driven by scripts/catalog.mjs: renders every preset
 * offline (butterchurn's render() accepts injected audioLevels and
 * elapsedTime, so the clock and "track" are scripted and deterministic)
 * and measures it. No audio hardware or realtime playback involved.
 */

import butterchurnModule from 'butterchurn'
import { unwrapButterchurn } from './background'
import { loadAllPresets } from './presetPacks'
import {
  audioLevels,
  STRIP_DT as DT,
  STRIP_END,
  STRIP_FPS as FPS,
  STRIP_H as RH,
  STRIP_W as RW,
} from './stripTrack'

const butterchurn = unwrapButterchurn(butterchurnModule)

const GW = 160
const GH = 90

// --- pixel helpers -----------------------------------------------------------

interface Grab {
  data: Uint8ClampedArray
  meanLum: number
  std: number
}

function luminance(d: Uint8ClampedArray, i: number): number {
  return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
}

function grabStats(data: Uint8ClampedArray): Grab {
  let sum = 0
  let sumSq = 0
  const n = data.length / 4
  for (let i = 0; i < data.length; i += 4) {
    const lum = luminance(data, i)
    sum += lum
    sumSq += lum * lum
  }
  const meanLum = sum / n
  return { data, meanLum, std: Math.sqrt(Math.max(0, sumSq / n - meanLum * meanLum)) }
}

function frameDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(luminance(a, i) - luminance(b, i))
  }
  return sum / (a.length / 4) / 255
}

function dominantColors(data: Uint8ClampedArray): [number, number, number][] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i < data.length; i += 4) {
    if (luminance(data, i) < 12) continue
    const key = ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5)
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    bucket.n++
    bucket.r += data[i]
    bucket.g += data[i + 1]
    bucket.b += data[i + 2]
    buckets.set(key, bucket)
  }
  const top = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 3)
  if (top.length === 0) return [[0, 0, 0]]
  return top.map((b) => [
    Math.round(b.r / b.n),
    Math.round(b.g / b.n),
    Math.round(b.b / b.n),
  ])
}

function meanSaturation(data: Uint8ClampedArray): number {
  let sum = 0
  let weight = 0
  for (let i = 0; i < data.length; i += 4) {
    const max = Math.max(data[i], data[i + 1], data[i + 2])
    const min = Math.min(data[i], data[i + 1], data[i + 2])
    const sat = max === 0 ? 0 : (max - min) / max
    const w = max / 255
    sum += sat * w
    weight += w
  }
  return weight > 0 ? sum / weight : 0
}

function detailLevel(data: Uint8ClampedArray): number {
  let sum = 0
  let n = 0
  for (let y = 0; y < GH - 1; y++) {
    for (let x = 0; x < GW - 1; x++) {
      const i = (y * GW + x) * 4
      const lum = luminance(data, i)
      sum += Math.abs(lum - luminance(data, i + 4))
      sum += Math.abs(lum - luminance(data, i + GW * 4))
      n += 2
    }
  }
  return sum / n / 255
}

/** How readable white text would be over the center band (0..1). */
function readability(data: Uint8ClampedArray): number {
  const lums: number[] = []
  for (let y = Math.floor(GH * 0.3); y < GH * 0.62; y++) {
    for (let x = Math.floor(GW * 0.1); x < GW * 0.9; x++) {
      lums.push(luminance(data, (y * GW + x) * 4))
    }
  }
  lums.sort((a, b) => a - b)
  const p90 = lums[Math.floor(lums.length * 0.9)]
  const mean = lums.reduce((a, b) => a + b, 0) / lums.length
  const std = Math.sqrt(
    Math.max(0, lums.reduce((a, b) => a + b * b, 0) / lums.length - mean * mean),
  )
  return Math.max(0, Math.min(1, 1 - (0.7 * p90) / 255 - (0.3 * std) / 128))
}

// --- capture -----------------------------------------------------------------

export interface PresetMeasurements {
  colors: [number, number, number][]
  brightness: number
  saturation: number
  motion: number
  detail: number
  beatResponse: number
  flicker: number
  readability: number
  costMs: number
  flags: string[]
  error?: string
}

const canvas = document.createElement('canvas')
canvas.width = RW
canvas.height = RH
const grabCanvas = document.createElement('canvas')
grabCanvas.width = GW
grabCanvas.height = GH
const grabCtx = grabCanvas.getContext('2d', { willReadFrequently: true })!
const stripCanvas = document.createElement('canvas')
stripCanvas.width = RW * 4
stripCanvas.height = RH
const stripCtx = stripCanvas.getContext('2d')!

function grab(): Grab {
  grabCtx.drawImage(canvas, 0, 0, GW, GH)
  return grabStats(grabCtx.getImageData(0, 0, GW, GH).data)
}

async function capture(
  name: string,
): Promise<{ measurements: PresetMeasurements; strip: string | null }> {
  const flags: string[] = []
  try {
    const presets = await loadAllPresets()
    const preset = presets[name]
    if (!preset) throw new Error('preset not found')
    const context = new AudioContext()
    const visualizer = butterchurn.createVisualizer(context, canvas, {
      width: RW,
      height: RH,
    })
    visualizer.loadPreset(preset, 0)

    const captures: Record<string, Grab> = {}
    const stripAt: Record<number, number> = { 3.1: 0, 4.8: 1, 6.07: 2, 8.5: 3 }
    const stripTimes = Object.keys(stripAt).map(Number)
    const motionGrabs: Grab[] = []
    const beatGrabs: { t: number; g: Grab }[] = []
    const costs: number[] = []
    let nextStrip = 0

    const frames = Math.round(STRIP_END * FPS)
    for (let i = 0; i < frames; i++) {
      const t = i * DT
      const start = performance.now()
      visualizer.render({ elapsedTime: DT, audioLevels: audioLevels(t) })
      if (t >= 1 && t < 2) costs.push(performance.now() - start)
      if (t >= 4.0 && t < 5.3) motionGrabs.push(grab())
      if (t >= 5.85 && t < 6.35) beatGrabs.push({ t, g: grab() })
      if (nextStrip < stripTimes.length && t >= stripTimes[nextStrip]) {
        const g = grab()
        if (stripTimes[nextStrip] === 3.1) captures.quiet = g
        if (stripTimes[nextStrip] === 4.8) captures.loud = g
        if (stripTimes[nextStrip] === 6.07) captures.beat = g
        if (stripTimes[nextStrip] === 8.5) captures.later = g
        stripCtx.drawImage(canvas, nextStrip * RW, 0, RW, RH)
        nextStrip++
      }
    }
    await context.close()

    const loud = captures.loud
    let motion = 0
    for (let i = 1; i < motionGrabs.length; i++) {
      motion += frameDiff(motionGrabs[i - 1].data, motionGrabs[i].data)
    }
    motion /= Math.max(1, motionGrabs.length - 1)
    const lumSeries = motionGrabs.map((g) => g.meanLum)
    const lumMean = lumSeries.reduce((a, b) => a + b, 0) / lumSeries.length
    const flicker =
      Math.sqrt(
        Math.max(
          0,
          lumSeries.reduce((a, b) => a + b * b, 0) / lumSeries.length - lumMean * lumMean,
        ),
      ) / 128

    const pre = beatGrabs.filter((b) => b.t < 6.0)
    const post = beatGrabs.filter((b) => b.t >= 6.0 && b.t < 6.2)
    const preLum = pre.reduce((a, b) => a + b.g.meanLum, 0) / Math.max(1, pre.length)
    const postLum = post.reduce((a, b) => a + b.g.meanLum, 0) / Math.max(1, post.length)
    let preMotion = 0
    for (let i = 1; i < pre.length; i++) preMotion += frameDiff(pre[i - 1].g.data, pre[i].g.data)
    preMotion /= Math.max(1, pre.length - 1)
    let postMotion = 0
    for (let i = 1; i < post.length; i++)
      postMotion += frameDiff(post[i - 1].g.data, post[i].g.data)
    postMotion /= Math.max(1, post.length - 1)
    const beatResponse = Math.max(
      0,
      Math.min(1, ((postLum - preLum) / 255) * 5 + Math.max(0, postMotion - preMotion) * 12),
    )

    const brightness = (loud.meanLum + captures.later.meanLum) / 2 / 255
    if (loud.std < 2.5 && motion < 0.002) flags.push('blank')
    if (flicker > 0.22) flags.push('strobe')

    return {
      measurements: {
        colors: dominantColors(loud.data),
        brightness: Number(brightness.toFixed(4)),
        saturation: Number(meanSaturation(loud.data).toFixed(4)),
        motion: Number(motion.toFixed(5)),
        detail: Number(detailLevel(loud.data).toFixed(4)),
        beatResponse: Number(beatResponse.toFixed(4)),
        flicker: Number(flicker.toFixed(4)),
        readability: Number(
          Math.min(readability(loud.data), readability(captures.later.data)).toFixed(4),
        ),
        costMs: Number(
          (costs.reduce((a, b) => a + b, 0) / Math.max(1, costs.length)).toFixed(3),
        ),
        flags,
      },
      strip: stripCanvas.toDataURL('image/png'),
    }
  } catch (error) {
    return {
      measurements: {
        colors: [[0, 0, 0]],
        brightness: 0,
        saturation: 0,
        motion: 0,
        detail: 0,
        beatResponse: 0,
        flicker: 0,
        readability: 0,
        costMs: 0,
        flags: ['error'],
        error: String(error).slice(0, 300),
      },
      strip: null,
    }
  }
}

async function listPresets(): Promise<string[]> {
  return Object.keys(await loadAllPresets()).sort()
}

declare global {
  interface Window {
    __catalog: {
      listPresets(): Promise<string[]>
      capture(name: string): Promise<{ measurements: PresetMeasurements; strip: string | null }>
    }
    __catalogReady: boolean
  }
}

window.__catalog = { listPresets, capture }
window.__catalogReady = true
