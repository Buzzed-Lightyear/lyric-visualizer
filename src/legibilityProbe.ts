/**
 * Measures how readable the text actually is over every scene a song
 * plays. Dev-only (harness and contact sheets); it runs the real text
 * layer, not a model of it.
 *
 * For one scene: the preset's four strip frames (quiet, loud, on a beat,
 * later — the catalog strip when it is on disk, else rendered here on
 * the same scripted track) are put behind a line of text in turn. The
 * line enters over the first frame and is HELD while the background
 * changes to the next three, so the held polarity and the eased backing
 * are what get measured. On each frame, every pixel just inside a glyph
 * edge is paired with the pixel just outside it — the text against its
 * immediate surround, backing included — and the pair's WCAG contrast
 * ratio is one sample.
 *
 * The same run is done in the old mode (global scrim, fixed colors) for
 * the "before" numbers.
 */

import type { AudioFrame } from './audioMath'
import { BackdropSampler } from './backdrop'
import { contrastRatio, relativeLuminance, type Polarity } from './legibility'
import { parseIndex } from './library'
import { sectionGrammar, textParamsForLine } from './mapping'
import {
  CATALOG,
  feedbackFor,
  parseFeedbackFile,
  pickForSections,
  type LabelPick,
} from './presetPick'
import { createRandom } from './random'
import { parseSemantics, type SemanticSection, type SongLook } from './semantics'
import {
  renderStripFrames,
  STRIP_CONDITIONS,
  STRIP_H,
  STRIP_W,
} from './stripTrack'
import { TextLayer, type PartOverrides } from './textLayer'
import { THRESHOLDS } from './thresholds'
import { LEGIBLE } from './tuning'

/** The size the probe renders at (a 16:9 view). */
const PW = 960
const PH = 540
const DT = 1 / 60
/** A steady, beatless frame: the probe is about color, not motion. */
const STILL: AudioFrame = { level: 0.3, bass: 0.2, mid: 0.2, high: 0.2, beat: 0 }
/** Sim seconds before the first capture (all words in and settled), then per frame. */
const ENTER_SEC = 3
const HOLD_SEC = 1.2
const OVERRIDES: PartOverrides = { entrance: 'creep', hold: 'still', exit: 'blow', layout: 'centered' }

export interface ContrastSummary {
  /** Share of samples at or above the contrast floor, 0..1. */
  pass: number
  median: number
  samples: number
}

export interface SceneReadability {
  label: string
  preset: string
  source: LabelPick['source']
  /** Where the four frames came from. */
  frames: 'strip' | 'rendered'
  /** The old mode: global scrim, fixed colors. */
  before: ContrastSummary
  /** Adaptive text with its backing. */
  after: ContrastSummary
  polarity: Polarity | null
  /** Backing strength on each of the four frames. */
  strength: number[]
  /** Whether the focus word carried a palette accent. */
  accent: boolean
  /** With `images`: the four frames with the text over them (JPEG data URLs). */
  images?: string[]
}

export interface SongReadability {
  slug: string
  title: string
  scenes: SceneReadability[]
  /** Scenes left out because no frames could be made (no strip, no WebGL 2). */
  skipped: string[]
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

/** The preset's strip from `npm run catalog`, cut into its four frames. */
function stripFromDisk(name: string): Promise<HTMLCanvasElement[] | null> {
  const entry = CATALOG[name]
  if (!entry) return Promise.resolve(null)
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      if (image.naturalWidth !== STRIP_W * STRIP_CONDITIONS.length || image.naturalHeight !== STRIP_H) {
        resolve(null)
        return
      }
      resolve(
        STRIP_CONDITIONS.map((_, i) => {
          const frame = canvasOf(STRIP_W, STRIP_H)
          frame.getContext('2d')!.drawImage(image, -i * STRIP_W, 0)
          return frame
        }),
      )
    }
    // A missing strip comes back as the app's HTML: not an image.
    image.onerror = () => resolve(null)
    image.src = `/catalog-strips/${entry.slug}.png`
  })
}

const frameCache = new Map<string, Promise<{ frames: HTMLCanvasElement[]; from: 'strip' | 'rendered' } | null>>()

/** The four strip frames of a preset: from disk when there, else rendered now. */
export function presetFrames(
  name: string,
): Promise<{ frames: HTMLCanvasElement[]; from: 'strip' | 'rendered' } | null> {
  let cached = frameCache.get(name)
  if (!cached) {
    cached = (async () => {
      const disk = await stripFromDisk(name)
      if (disk) return { frames: disk, from: 'strip' as const }
      const rendered = await renderStripFrames(name)
      return rendered ? { frames: rendered, from: 'rendered' as const } : null
    })()
    frameCache.set(name, cached)
  }
  return cached
}

function summarize(ratios: number[]): ContrastSummary {
  if (ratios.length === 0) return { pass: 0, median: 0, samples: 0 }
  const sorted = Float32Array.from(ratios).sort()
  let passing = 0
  for (const ratio of sorted) if (ratio >= THRESHOLDS.textContrastFloor) passing++
  return {
    pass: passing / sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    samples: sorted.length,
  }
}

/**
 * Contrast samples for one frame: `composite` is what the viewer sees,
 * `mask` the glyphs alone. A sample pairs a solid glyph pixel with the
 * first clear pixel two steps outside it.
 */
function contrastSamples(composite: ImageData, mask: ImageData, out: number[]): void {
  const { width, height } = composite
  const c = composite.data
  const m = mask.data
  const lum = (i: number) => relativeLuminance([c[i], c[i + 1], c[i + 2]])
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const i = (y * width + x) * 4
      if (m[i + 3] < 200) continue
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const j = ((y + dy * 2) * width + (x + dx * 2)) * 4
        if (m[j + 3] > 8) continue
        out.push(contrastRatio(lum(i), lum(j)))
      }
    }
  }
}

interface SceneRun {
  summary: ContrastSummary
  polarity: Polarity | null
  strength: number[]
  accent: boolean
  composites: HTMLCanvasElement[]
}

/** One line of text held over the four frames, in one mode. */
function runScene(
  frames: HTMLCanvasElement[],
  text: string,
  section: SemanticSection | null,
  look: SongLook | null,
  oldScrim: boolean,
): SceneRun {
  const wasOld = LEGIBLE.oldScrim
  LEGIBLE.oldScrim = oldScrim
  try {
    const background = canvasOf(PW, PH)
    const backgroundCtx = background.getContext('2d')!
    const textCanvas = canvasOf(PW, PH)
    const layer = new TextLayer(textCanvas, createRandom(7))
    layer.resize(PW, PH, 1)
    const textCtx = textCanvas.getContext('2d', { willReadFrequently: true })!
    const sampler = new BackdropSampler()
    const grammar = sectionGrammar(section, look)
    const params = textParamsForLine(section, 0.5, { grammar, focus: [0] }, look)
    const line = { index: 0, text, start: 0, end: 2 }
    const ratios: number[] = []
    const run: SceneRun = {
      summary: { pass: 0, median: 0, samples: 0 },
      polarity: null,
      strength: [],
      accent: false,
      composites: [],
    }
    let time = 0
    frames.forEach((frame, k) => {
      backgroundCtx.drawImage(frame, 0, 0, PW, PH)
      sampler.update(background, true)
      const steps = Math.round((k === 0 ? ENTER_SEC : HOLD_SEC) / DT)
      for (let i = 0; i < steps; i++) {
        layer.draw(
          STILL,
          { params, line, time, overrides: OVERRIDES, backdrop: sampler.backdrop },
          DT,
          i === steps - 1,
        )
        time += DT
      }
      const state = layer.legibility()
      run.polarity = state?.polarity ?? null
      run.strength.push(Number((state?.strength ?? 0).toFixed(3)))
      run.accent = state?.accent ?? false

      const composite = canvasOf(PW, PH)
      const compositeCtx = composite.getContext('2d', { willReadFrequently: true })!
      compositeCtx.drawImage(background, 0, 0)
      compositeCtx.drawImage(textCanvas, 0, 0)
      run.composites.push(composite)
      const seen = compositeCtx.getImageData(0, 0, PW, PH)
      layer.drawGlyphMask(time)
      contrastSamples(seen, textCtx.getImageData(0, 0, PW, PH), ratios)
    })
    run.summary = summarize(ratios)
    return run
  } finally {
    LEGIBLE.oldScrim = wasOld
  }
}

function toJpeg(canvas: HTMLCanvasElement, w: number, h: number): string {
  const small = canvasOf(w, h)
  small.getContext('2d')!.drawImage(canvas, 0, 0, w, h)
  return small.toDataURL('image/jpeg', 0.86)
}

/** Measure every scene of one song. Fonts must be loaded first. */
export async function probeSong(
  song: { slug: string; title: string; base: string },
  options: { images?: boolean } = {},
): Promise<SongReadability | null> {
  const response = await fetch(song.base + 'semantics.json')
  if (!response.ok) return null
  const { semantics } = parseSemantics((await response.json()) as unknown)
  if (!semantics) return null
  const look = semantics.look ?? null
  const feedbackFile = parseFeedbackFile((await import('./presetFeedback.json')).default)
  const picks = pickForSections(semantics.sections, feedbackFor(feedbackFile, song.slug), CATALOG, look)
  const result: SongReadability = { slug: song.slug, title: song.title, scenes: [], skipped: [] }
  for (const pick of picks.values()) {
    if (!pick.chosen) continue
    const got = await presetFrames(pick.chosen)
    if (!got) {
      result.skipped.push(pick.label)
      continue
    }
    const section = semantics.sections.find((s) => s.label === pick.label) ?? null
    const before = runScene(got.frames, song.title, section, look, true)
    const after = runScene(got.frames, song.title, section, look, false)
    result.scenes.push({
      label: pick.label,
      preset: pick.chosen,
      source: pick.source,
      frames: got.from,
      before: before.summary,
      after: after.summary,
      polarity: after.polarity,
      strength: after.strength,
      accent: after.accent,
      ...(options.images
        ? { images: after.composites.map((composite) => toJpeg(composite, 640, 360)) }
        : {}),
    })
  }
  return result
}

/** The songs to measure: the library, or the fixtures when it is empty. */
export async function probeSongs(): Promise<{ slug: string; title: string; base: string }[]> {
  for (const index of ['/songs/index.json', '/fixture/index.json']) {
    try {
      const response = await fetch(index)
      if (!response.ok) continue
      const entries = parseIndex((await response.json()) as unknown)
      if (entries.length > 0) {
        return entries.map((entry) => ({ slug: entry.slug, title: entry.title, base: entry.base }))
      }
    } catch {
      // try the next index
    }
  }
  return []
}

/** Measure every scene of every song. */
export async function probeLibrary(options: { images?: boolean } = {}): Promise<SongReadability[]> {
  const out: SongReadability[] = []
  for (const song of await probeSongs()) {
    const result = await probeSong(song, options)
    if (result) out.push(result)
  }
  return out
}
