import type { AudioFrame } from './analysis'
import { SCENE } from './tuning'

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
 * The renderer side of the seam: receives only (AudioFrame, delta time).
 * Level drives particle speed and brightness, bass swells the central glow,
 * beat kicks it, mid bends the particle paths, high makes them twinkle.
 */
export class Scene {
  private readonly ctx: CanvasRenderingContext2D
  private readonly particles: Particle[] = []
  private w = 1
  private h = 1
  private time = 0
  private readonly canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is unavailable')
    this.ctx = ctx
    for (let i = 0; i < SCENE.particleCount; i++) {
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

  draw(frame: AudioFrame, dt: number): void {
    this.time += dt
    const { ctx, w, h } = this
    const minDim = Math.min(w, h)

    // Fade toward the background instead of clearing, leaving short trails.
    ctx.globalCompositeOperation = 'source-over'
    const fade = 1 - Math.exp(-SCENE.trailFade * dt)
    ctx.fillStyle = `rgba(${SCENE.backgroundRgb}, ${fade})`
    ctx.fillRect(0, 0, w, h)

    ctx.globalCompositeOperation = 'lighter'

    // Central glow: swells with bass, kicks on beat, breathes when idle.
    const breath = Math.sin(this.time * SCENE.breathRate) * SCENE.breathAmount
    const glowR =
      minDim *
      (SCENE.glowBase +
        breath +
        frame.bass * SCENE.glowBass +
        frame.beat * SCENE.glowBeat)
    const cx = w / 2
    const cy = h / 2
    const glowAlpha = SCENE.glowAlphaBase + frame.bass * SCENE.glowAlphaBass
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR)
    gradient.addColorStop(0, `rgba(255, 148, 64, ${glowAlpha})`)
    gradient.addColorStop(1, 'rgba(255, 148, 64, 0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2)
    ctx.fill()

    // Beat accent: a ring that spreads and fades as the pulse decays.
    if (frame.beat > 0.02) {
      const ringR = glowR * (1 + (1 - frame.beat) * SCENE.ringSpread)
      ctx.strokeStyle = `rgba(255, 180, 90, ${frame.beat * SCENE.ringAlpha})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2)
      ctx.stroke()
    }

    // Particles. Idle floors keep them drifting through pauses and quiet
    // songs; level, mid and high ride on top.
    const drive = SCENE.idleSpeed + frame.level * SCENE.levelSpeed
    const wander = SCENE.wanderIdle + frame.mid * SCENE.wanderMid
    for (const p of this.particles) {
      p.angle += Math.sin(this.time * SCENE.wanderRate + p.phase) * wander * dt
      const step = drive * p.speed * dt
      p.x += Math.cos(p.angle) * step
      p.y += Math.sin(p.angle) * step
      if (p.x < 0 || p.x > 1) p.x = ((p.x % 1) + 1) % 1
      if (p.y < 0 || p.y > 1) p.y = ((p.y % 1) + 1) % 1

      const twinkle = 0.5 + 0.5 * Math.sin(this.time * SCENE.twinkleRate + p.phase * 7)
      const alpha = Math.min(
        1,
        SCENE.particleAlphaBase +
          frame.level * SCENE.particleAlphaLevel +
          twinkle * frame.high * SCENE.particleAlphaHigh,
      )
      const size = p.size * (1 + frame.beat * SCENE.particleBeatSize)
      ctx.fillStyle = `rgba(168, 200, 255, ${alpha})`
      ctx.beginPath()
      ctx.arc(p.x * w, p.y * h, size, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.globalCompositeOperation = 'source-over'
  }

  /** Labeled bars for the five AudioFrame values, drawn over the scene. */
  drawDebug(frame: AudioFrame): void {
    const { ctx } = this
    const rows: [string, number][] = [
      ['level', frame.level],
      ['bass', frame.bass],
      ['mid', frame.mid],
      ['high', frame.high],
      ['beat', frame.beat],
    ]
    const x = 12
    const y = 12
    const labelW = 44
    const barW = 160
    const barH = 10
    const gap = 18

    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fillRect(x - 8, y - 8, labelW + barW + 58, rows.length * gap + 10)
    ctx.font = '11px monospace'
    ctx.textBaseline = 'top'
    rows.forEach(([name, value], i) => {
      const rowY = y + i * gap
      ctx.fillStyle = '#9fb4d8'
      ctx.fillText(name, x, rowY)
      ctx.fillText(value.toFixed(2), x + labelW + barW + 6, rowY)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
      ctx.fillRect(x + labelW, rowY, barW, barH)
      ctx.fillStyle = name === 'beat' ? '#ffb45a' : '#7fd1a8'
      ctx.fillRect(x + labelW, rowY, barW * value, barH)
    })
  }
}
