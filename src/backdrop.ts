/**
 * Samples the background for the text layer: the background canvas is
 * drawn into a small offscreen Canvas 2D right after it renders, and
 * read back as a grid of point samples (no smoothing, so the samples
 * keep the real contrast of a busy scene instead of averaging it away).
 * Sampling every few frames is enough: polarity is decided per line and
 * the backing is eased.
 */

import type { Backdrop } from './legibility'
import { LEGIBLE } from './tuning'

export class BackdropSampler {
  private readonly canvas = document.createElement('canvas')
  private readonly ctx: CanvasRenderingContext2D
  private frame = 0
  private sample: Backdrop | null = null
  /** Milliseconds the last sample took (draw + readback), for the debug overlay. */
  lastMs = 0

  constructor() {
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas 2D is unavailable')
    this.ctx = ctx
  }

  /** The latest sample; null means "treat the background as black". */
  get backdrop(): Backdrop | null {
    return this.sample
  }

  /**
   * Call once per frame, right after the background canvas rendered.
   * Takes a new sample every LEGIBLE.sampleEvery frames (`force` takes
   * one now).
   */
  update(source: HTMLCanvasElement | null, force = false): void {
    const due = force || this.frame % Math.max(1, Math.round(LEGIBLE.sampleEvery)) === 0
    this.frame++
    if (!due) return
    if (!source || source.width < 1 || source.height < 1) {
      this.clear()
      return
    }
    const start = performance.now()
    const w = Math.max(8, Math.round(LEGIBLE.sampleW))
    const h = Math.max(8, Math.round(LEGIBLE.sampleH))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.ctx.imageSmoothingEnabled = false
    this.ctx.drawImage(source, 0, 0, w, h)
    const { data } = this.ctx.getImageData(0, 0, w, h)
    this.sample = { width: w, height: h, data, version: (this.sample?.version ?? 0) + 1 }
    this.lastMs = performance.now() - start
  }

  /** A black background (the "black" mode, or nothing rendered yet). */
  clear(): void {
    if (this.sample === null) return
    this.sample = null
  }
}
