import type { AudioFrame } from './analysis'
import type { SceneParams } from './mapping'
import { MOTIFS, SCENE } from './tuning'

/** Pre-formatted strings for the debug overlay; the scene just prints them. */
export interface DebugInfo {
  semantics: string
  section: string
  motif: string
  emphasis: number
}

interface Particle {
  /** Position in 0..1 window-relative coordinates. */
  x: number
  y: number
  /** Drift direction in radians. */
  angle: number
  /** Per-particle speed multiplier. */
  speed: number
  /** Radius in CSS pixels. */
  size: number
  /** Desynchronizes wander and twinkle between particles. */
  phase: number
}

/**
 * The renderer side of the seam: receives only (AudioFrame, SceneParams,
 * delta time). Audio decides when things move; SceneParams decide what
 * moves, in which colors, and how much.
 */
export class Scene {
  private readonly ctx: CanvasRenderingContext2D
  private readonly particles: Particle[] = []
  private readonly canvas: HTMLCanvasElement
  private w = 1
  private h = 1
  private time = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is unavailable')
    this.ctx = ctx
    for (let i = 0; i < SCENE.maxParticles; i++) {
      this.particles.push({
        x: Math.random(),
        y: Math.random(),
        angle: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random(),
        size: 1 + Math.random() * 2,
        phase: Math.random() * Math.PI * 2,
      })
    }
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1
    this.w = window.innerWidth
    this.h = window.innerHeight
    this.canvas.width = Math.round(this.w * dpr)
    this.canvas.height = Math.round(this.h * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.ctx.fillStyle = `rgba(${SCENE.backgroundRgb}, 1)`
    this.ctx.fillRect(0, 0, this.w, this.h)
  }

  draw(frame: AudioFrame, params: SceneParams, dt: number): void {
    this.time += dt
    const { ctx, w, h } = this
    const minDim = Math.min(w, h)
    const [bgR, bgG, bgB] = params.background
    // Emphasis scales how hard the audio-driven accents land.
    const kick = Math.min(1.5, frame.beat * params.accent)

    // Fade toward the background instead of clearing, leaving short trails.
    ctx.globalCompositeOperation = 'source-over'
    const fade = 1 - Math.exp(-SCENE.trailFade * dt)
    ctx.fillStyle = `rgba(${bgR | 0}, ${bgG | 0}, ${bgB | 0}, ${fade})`
    ctx.fillRect(0, 0, w, h)

    ctx.globalCompositeOperation = 'lighter'

    // Central glow: swells with bass, kicks on beat, breathes when idle.
    const breath = Math.sin(this.time * SCENE.breathRate) * SCENE.breathAmount
    const glowR =
      minDim *
      (SCENE.glowBase + breath + frame.bass * SCENE.glowBass + kick * SCENE.glowBeat) *
      params.glowScale
    const cx = w / 2
    const cy = h / 2
    const [glR, glG, glB] = params.glowColor
    const glowAlpha = SCENE.glowAlphaBase + frame.bass * SCENE.glowAlphaBass
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR)
    gradient.addColorStop(0, `rgba(${glR | 0}, ${glG | 0}, ${glB | 0}, ${glowAlpha})`)
    gradient.addColorStop(1, `rgba(${glR | 0}, ${glG | 0}, ${glB | 0}, 0)`)
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2)
    ctx.fill()

    // Beat accent: a ring that spreads and fades as the pulse decays.
    if (frame.beat > 0.02) {
      const [riR, riG, riB] = params.ringColor
      const ringR = glowR * (1 + (1 - frame.beat) * SCENE.ringSpread)
      ctx.strokeStyle = `rgba(${riR | 0}, ${riG | 0}, ${riB | 0}, ${Math.min(1, kick * SCENE.ringAlpha)})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2)
      ctx.stroke()
    }

    // Particles. Idle floors keep them drifting through pauses and quiet
    // songs; level, mid and high ride on top; the motif sets the character.
    const motif = MOTIFS[params.motif]
    const count = Math.min(this.particles.length, Math.max(0, Math.round(params.particleCount)))
    const drive = (SCENE.idleSpeed + frame.level * SCENE.levelSpeed) * params.speed * motif.speed
    const wander = (SCENE.wanderIdle + frame.mid * SCENE.wanderMid) * params.jitter * motif.wander
    const biasY = motif.biasY * (0.4 + frame.level * 0.8) - params.lift * SCENE.liftBias
    const [pR, pG, pB] = params.particleColor
    for (let i = 0; i < count; i++) {
      const p = this.particles[i]
      p.angle += Math.sin(this.time * SCENE.wanderRate + p.phase) * wander * dt
      const dx = Math.cos(p.angle) * drive * p.speed * dt
      const dy = Math.sin(p.angle) * drive * p.speed * dt + biasY * dt
      p.x += dx
      p.y += dy
      if (p.x < 0 || p.x > 1) p.x = ((p.x % 1) + 1) % 1
      if (p.y < 0 || p.y > 1) p.y = ((p.y % 1) + 1) % 1

      const twinkle = 0.5 + 0.5 * Math.sin(this.time * SCENE.twinkleRate + p.phase * 7)
      const alpha = Math.min(
        1,
        SCENE.particleAlphaBase +
          frame.level * SCENE.particleAlphaLevel +
          twinkle * (0.1 + 0.9 * frame.high) * SCENE.particleAlphaHigh * motif.twinkle,
      )
      const size = p.size * motif.width * (1 + Math.min(1, kick) * SCENE.particleBeatSize)
      const color = `rgba(${pR | 0}, ${pG | 0}, ${pB | 0}, ${alpha})`
      const px = p.x * w
      const py = p.y * h
      if (motif.streak > 0) {
        const len = Math.hypot(dx * w, dy * h) || 1
        const trail = motif.streak * (0.6 + frame.level)
        ctx.strokeStyle = color
        ctx.lineWidth = size
        ctx.beginPath()
        ctx.moveTo(px - (dx * w * trail) / len, py - (dy * h * trail) / len)
        ctx.lineTo(px, py)
        ctx.stroke()
      } else {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(px, py, size, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    ctx.globalCompositeOperation = 'source-over'
  }

  /** Bars for the five AudioFrame values plus the current semantic state. */
  drawDebug(frame: AudioFrame, info: DebugInfo): void {
    const { ctx } = this
    const bars: [string, number][] = [
      ['level', frame.level],
      ['bass', frame.bass],
      ['mid', frame.mid],
      ['high', frame.high],
      ['beat', frame.beat],
    ]
    const texts = [
      `sem    ${info.semantics}`,
      `sect   ${info.section}`,
      `motif  ${info.motif}`,
      `emph   ${info.emphasis.toFixed(2)}`,
    ]
    const x = 12
    const y = 12
    const labelW = 44
    const barW = 160
    const barH = 10
    const gap = 18

    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fillRect(x - 8, y - 8, 330, bars.length * gap + texts.length * gap + 14)
    ctx.font = '11px monospace'
    ctx.textBaseline = 'top'
    bars.forEach(([name, value], i) => {
      const rowY = y + i * gap
      ctx.fillStyle = '#9fb4d8'
      ctx.fillText(name, x, rowY)
      ctx.fillText(value.toFixed(2), x + labelW + barW + 6, rowY)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
      ctx.fillRect(x + labelW, rowY, barW, barH)
      ctx.fillStyle = name === 'beat' ? '#ffb45a' : '#7fd1a8'
      ctx.fillRect(x + labelW, rowY, barW * value, barH)
    })
    ctx.fillStyle = '#9fb4d8'
    texts.forEach((text, i) => {
      ctx.fillText(text, x, y + bars.length * gap + 6 + i * gap)
    })
  }
}
