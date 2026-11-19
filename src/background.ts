/**
 * The background layer: butterchurn (MilkDrop-style, WebGL 2) on its own
 * canvas, or the old scene, or black. B cycles. If WebGL 2 is missing,
 * butterchurn is marked unsupported and the mode falls back to the scene.
 * Preset data loads lazily from the packs; which preset plays is decided
 * by the caller (src/presetPick.ts scores the committed catalog).
 */

import butterchurnModule, { type ButterchurnVisualizer } from 'butterchurn'
import { getAudioGraph } from './analysis'
import { getPreset } from './presetPacks'
import { BUTTERCHURN } from './tuning'

/** The UMD build lands as either the API object or { default: api }. */
export function unwrapButterchurn(mod: unknown): typeof butterchurnModule {
  const m = mod as { createVisualizer?: unknown; default?: unknown }
  return (typeof m.createVisualizer === 'function' ? m : m.default) as typeof butterchurnModule
}

const butterchurn = unwrapButterchurn(butterchurnModule)

export type BackgroundMode = 'butterchurn' | 'scene' | 'black'

const MODES: BackgroundMode[] = ['butterchurn', 'scene', 'black']

export class Background {
  mode: BackgroundMode = 'butterchurn'
  currentPreset = '(none)'
  private readonly canvas: HTMLCanvasElement
  private readonly audio: HTMLAudioElement
  private visualizer: ButterchurnVisualizer | null = null
  private unsupported = false
  private cssW = 1
  private cssH = 1
  private appliedW = 0
  private appliedH = 0
  private pending: { name: string; blendSec: number } | null = null
  /** Guards against an older async load landing after a newer one. */
  private loadSeq = 0

  constructor(canvas: HTMLCanvasElement, audio: HTMLAudioElement) {
    this.canvas = canvas
    this.audio = audio
  }

  resize(width: number, height: number): void {
    this.cssW = width
    this.cssH = height
  }

  cycleMode(): void {
    let next = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]
    if (next === 'butterchurn' && this.unsupported) next = 'scene'
    this.mode = next
  }

  /** Called every frame while in butterchurn mode. */
  render(): void {
    if (!this.ensure()) return
    const w = Math.max(16, Math.round(this.cssW * BUTTERCHURN.resolution))
    const h = Math.max(16, Math.round(this.cssH * BUTTERCHURN.resolution))
    if (w !== this.appliedW || h !== this.appliedH) {
      this.canvas.width = w
      this.canvas.height = h
      this.visualizer!.setRendererSize(w, h)
      this.appliedW = w
      this.appliedH = h
    }
    this.visualizer!.render()
  }

  /** Load a preset by catalog name; queued until the visualizer exists. */
  loadByName(name: string, blendSec: number): void {
    if (!this.visualizer) {
      this.pending = { name, blendSec }
      return
    }
    const seq = ++this.loadSeq
    void getPreset(name).then((preset) => {
      if (!preset || seq !== this.loadSeq || !this.visualizer) return
      this.visualizer.loadPreset(preset, blendSec)
      this.currentPreset = name
    })
  }

  /** Lazy init: needs the audio graph (first play) and WebGL 2. */
  private ensure(): boolean {
    if (this.visualizer) return true
    if (this.unsupported) return false
    const graph = getAudioGraph(this.audio)
    if (!graph) return false
    if (!this.canvas.getContext('webgl2')) {
      console.warn('WebGL 2 unavailable; falling back to the canvas scene background')
      this.unsupported = true
      if (this.mode === 'butterchurn') this.mode = 'scene'
      return false
    }
    const w = Math.max(16, Math.round(this.cssW * BUTTERCHURN.resolution))
    const h = Math.max(16, Math.round(this.cssH * BUTTERCHURN.resolution))
    this.canvas.width = w
    this.canvas.height = h
    this.appliedW = w
    this.appliedH = h
    this.visualizer = butterchurn.createVisualizer(graph.context, this.canvas, {
      width: w,
      height: h,
    })
    this.visualizer.connectAudio(graph.source)
    if (this.pending) {
      const { name, blendSec } = this.pending
      this.pending = null
      this.loadByName(name, blendSec)
    }
    return true
  }
}
