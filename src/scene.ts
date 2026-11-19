/**
 * The renderer side of the seam. Receives only (AudioFrame, SceneParams,
 * dt) plus a seek notification; manages the gradient background and the
 * beat-committed crossfade between motif renderers. Deterministic: all
 * randomness comes from the injected Random, size from resize(), and time
 * from accumulated dt.
 */

import type { AudioFrame } from './audioMath'
import { NEUTRAL_PARAMS, type Motif, type Rgb, type SceneParams } from './mapping'
import { createRenderers, rgba, type MotifRenderer, type View } from './motifs'
import type { Random } from './random'
import { BG, SCENE, TRANSITION } from './tuning'

function copyParams(p: SceneParams): SceneParams {
  return {
    ...p,
    background: [...p.background],
    glowColor: [...p.glowColor],
    particleColor: [...p.particleColor],
    ringColor: [...p.ringColor],
  }
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x))
  return t * t * (3 - 2 * t)
}

/** For a crossfade where both sides share a motif: blend into one params. */
function blendParams(a: SceneParams, b: SceneParams, t: number): SceneParams {
  return {
    key: b.key,
    motif: b.motif,
    energy: mix(a.energy, b.energy, t),
    background: mixRgb(a.background, b.background, t),
    glowColor: mixRgb(a.glowColor, b.glowColor, t),
    particleColor: mixRgb(a.particleColor, b.particleColor, t),
    ringColor: mixRgb(a.ringColor, b.ringColor, t),
    particleCount: mix(a.particleCount, b.particleCount, t),
    speed: mix(a.speed, b.speed, t),
    glowScale: mix(a.glowScale, b.glowScale, t),
    jitter: mix(a.jitter, b.jitter, t),
    lift: mix(a.lift, b.lift, t),
    accent: mix(a.accent, b.accent, t),
  }
}

export class Scene {
  private readonly ctx: CanvasRenderingContext2D
  private readonly canvas: HTMLCanvasElement
  private readonly renderers: Record<Motif, MotifRenderer>
  private readonly view: View = { w: 1, h: 1 }
  private time = 0
  /** Committed (outgoing) params. */
  private current: SceneParams = copyParams(NEUTRAL_PARAMS)
  /** Incoming params while a crossfade runs. */
  private incoming: SceneParams | null = null
  private fadeX = 0
  private fadeDuration = 1
  /** A section change waiting for its committing beat. */
  private pending: SceneParams | null = null
  private pendingAge = 0
  /** Set by notifySeek: the next settle is fast and skips the beat wait. */
  private seekSettle = false
  /** Extra accent injected by a rising transition; decays like a beat. */
  private boost = 0

  constructor(canvas: HTMLCanvasElement, random: Random) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is unavailable')
    this.ctx = ctx
    this.renderers = createRenderers(random)
  }

  resize(width: number, height: number, dpr: number): void {
    this.view.w = width
    this.view.h = height
    this.canvas.width = Math.round(width * dpr)
    this.canvas.height = Math.round(height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.ctx.fillStyle = `rgba(${SCENE.backgroundRgb}, 1)`
    this.ctx.fillRect(0, 0, width, height)
  }

  /** The playhead jumped: settle quickly instead of waiting for a beat. */
  notifySeek(): void {
    this.seekSettle = true
  }

  /** For the harness: which params are committed, fading in, or waiting. */
  get transitionState(): { key: string; incoming: string | null; pending: string | null } {
    return {
      key: this.current.key,
      incoming: this.incoming?.key ?? null,
      pending: this.pending?.key ?? null,
    }
  }

  draw(frame: AudioFrame, target: SceneParams, dt: number): void {
    this.time += dt
    this.boost *= Math.exp(-TRANSITION.kickDecay * dt)
    this.updateTransition(target, frame, dt)

    const { ctx, view } = this
    const x = this.incoming ? smoothstep(this.fadeX) : 0
    const from = this.current
    const to = this.incoming

    // Background: flat for the neutral drift look, gradient + vignette for
    // semantic sections, blended across the crossfade. Repainted opaquely
    // every frame; trails are drawn explicitly by the renderers.
    const bgColor = mixRgb(from.background, (to ?? from).background, x)
    const bgGlow = mixRgb(from.glowColor, (to ?? from).glowColor, x)
    const strength = mix(from.motif === 'drift' ? 0 : 1, (to ?? from).motif === 'drift' ? 0 : 1, x)
    this.drawBackground(bgColor, bgGlow, strength)

    ctx.globalCompositeOperation = 'lighter'
    if (!to) {
      this.renderers[from.motif].draw(ctx, view, frame, from, dt, 1, this.boost, this.time)
    } else if (from.motif === to.motif) {
      // One pass so the shared renderer doesn't advance its particles twice.
      const blended = blendParams(from, to, x)
      this.renderers[blended.motif].draw(ctx, view, frame, blended, dt, 1, this.boost, this.time)
    } else {
      this.renderers[from.motif].draw(ctx, view, frame, from, dt, 1 - x, this.boost, this.time)
      this.renderers[to.motif].draw(ctx, view, frame, to, dt, x, this.boost, this.time)
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  private updateTransition(target: SceneParams, frame: AudioFrame, dt: number): void {
    const activeKey = this.incoming?.key ?? this.current.key
    if (target.key === activeKey) {
      // Same section: take live value changes (line emphasis) without a
      // transition, and drop any pending change that got reverted.
      if (this.incoming) this.incoming = copyParams(target)
      else this.current = copyParams(target)
      this.pending = null
      this.seekSettle = false
    } else {
      if (this.pending?.key === target.key) {
        this.pending = copyParams(target)
        this.pendingAge += dt
      } else {
        this.pending = copyParams(target)
        this.pendingAge = 0
      }
      // A section change commits on the next beat, or after a short wait,
      // or immediately when it came from a seek.
      if (
        this.seekSettle ||
        frame.beat >= TRANSITION.onsetBeat ||
        this.pendingAge >= TRANSITION.maxWaitSec
      ) {
        this.commit(this.pending)
      }
    }

    if (this.incoming) {
      this.fadeX += dt / this.fadeDuration
      if (this.fadeX >= 1) {
        this.current = this.incoming
        this.incoming = null
        this.fadeX = 0
      }
    }
  }

  private commit(next: SceneParams): void {
    // A commit mid-fade promotes the incoming side first.
    if (this.incoming) {
      this.current = this.incoming
      this.incoming = null
    }
    const delta = next.energy - this.current.energy
    let duration: number = TRANSITION.normalDuration
    if (this.seekSettle) {
      duration = TRANSITION.seekDuration
    } else if (delta > TRANSITION.energyDelta) {
      duration = TRANSITION.riseDuration
      this.boost = Math.max(this.boost, TRANSITION.riseKick)
    } else if (delta < -TRANSITION.energyDelta) {
      duration = TRANSITION.fallDuration
    }
    this.incoming = next
    this.fadeX = 0
    this.fadeDuration = duration
    this.pending = null
    this.seekSettle = false
  }

  private drawBackground(bg: Rgb, glow: Rgb, strength: number): void {
    const { ctx } = this
    const { w, h } = this.view
    const top = mixRgb(bg, [0, 0, 0], BG.topDarken * strength)
    const bottom = mixRgb(bg, glow, BG.bottomGlowMix * strength)
    const gradient = ctx.createLinearGradient(0, 0, 0, h)
    gradient.addColorStop(0, rgba(top, 1))
    gradient.addColorStop(1, rgba(bottom, 1))
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, w, h)
    if (strength > 0.01) {
      const r = Math.hypot(w, h) / 2
      const vignette = ctx.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r)
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
      vignette.addColorStop(1, `rgba(0, 0, 0, ${BG.vignette * strength})`)
      ctx.fillStyle = vignette
      ctx.fillRect(0, 0, w, h)
    }
  }

}
