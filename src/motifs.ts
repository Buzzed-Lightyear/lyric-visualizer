/**
 * One renderer per motif behind a shared interface. Each owns its
 * particles (seeded, deterministic), draws with additive blending and
 * pre-rendered soft sprites, and takes a crossfade alpha so transitions
 * can draw two motifs at once. No clock or window reads: time, size and
 * randomness all come in from outside.
 */

import type { AudioFrame } from './audioMath'
import type { Motif, Rgb, SceneParams } from './mapping'
import type { Random } from './random'
import { EMBERS, EMPHASIS, HAZE, RAIN, SCENE, STARS, TRAIL } from './tuning'

export interface View {
  w: number
  h: number
}

export interface MotifRenderer {
  /**
   * `alpha` is the crossfade weight (0..1); `boost` is an extra accent
   * injected by a rising transition; `time` is the scene's accumulated
   * simulated time.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    view: View,
    frame: AudioFrame,
    params: SceneParams,
    dt: number,
    alpha: number,
    boost: number,
    time: number,
  ): void
}

export function rgba(c: Rgb, a: number): string {
  return `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${Math.max(0, Math.min(1, a))})`
}

/** The beat kick after emphasis scaling plus any transition boost. */
function accentKick(frame: AudioFrame, params: SceneParams, boost: number): number {
  return Math.min(EMPHASIS.kickCap, frame.beat * params.accent + boost)
}

/** A (1 + slope * (accent - 1)) multiplier: exactly 1 at neutral accent. */
function accentMul(slope: number, accent: number): number {
  return 1 + slope * (accent - 1)
}

// --- Explicit trails --------------------------------------------------------

/** Ring buffer of recent positions (window-relative coordinates). */
class TrailBuffer {
  readonly xs: Float32Array
  readonly ys: Float32Array
  len = 0
  private head = -1
  private readonly cap: number

  constructor(cap: number) {
    this.cap = cap
    this.xs = new Float32Array(cap)
    this.ys = new Float32Array(cap)
  }

  push(x: number, y: number): void {
    this.head = (this.head + 1) % this.cap
    this.xs[this.head] = x
    this.ys[this.head] = y
    if (this.len < this.cap) this.len++
  }

  /** Buffer index of the k-th newest sample. */
  idx(k: number): number {
    return (this.head - k + this.cap * 2) % this.cap
  }

  clear(): void {
    this.len = 0
    this.head = -1
  }
}

interface Trailed {
  x: number
  y: number
  trail: TrailBuffer
}

/**
 * Tapering comet trails, batched by age bucket so the whole set costs
 * TRAIL.points strokes instead of one per segment.
 */
function drawTrails(
  ctx: CanvasRenderingContext2D,
  view: View,
  items: readonly Trailed[],
  count: number,
  color: Rgb,
  headAlpha: number,
  headWidth: number,
): void {
  const { w, h } = view
  for (let k = 0; k < TRAIL.points; k++) {
    const falloff = 1 - (k + 0.5) / TRAIL.points
    const a = headAlpha * falloff
    if (a < 0.004) continue
    ctx.strokeStyle = rgba(color, a)
    ctx.lineWidth = Math.max(0.4, headWidth * falloff)
    ctx.beginPath()
    for (let i = 0; i < count; i++) {
      const item = items[i]
      const trail = item.trail
      if (trail.len <= k) continue
      const bi = trail.idx(k)
      let ax: number
      let ay: number
      if (k === 0) {
        ax = item.x
        ay = item.y
      } else {
        const ai = trail.idx(k - 1)
        ax = trail.xs[ai]
        ay = trail.ys[ai]
      }
      const bx = trail.xs[bi]
      const by = trail.ys[bi]
      // A long segment means the particle wrapped an edge; skip it.
      if (Math.abs(ax - bx) > 0.2 || Math.abs(ay - by) > 0.2) continue
      ctx.moveTo(ax * w, ay * h)
      ctx.lineTo(bx * w, by * h)
    }
    ctx.stroke()
  }
}

// --- Soft sprites -----------------------------------------------------------

const SPRITE_SIZE = 64

function makeSprite(color: Rgb): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SPRITE_SIZE
  const ctx = canvas.getContext('2d')!
  const half = SPRITE_SIZE / 2
  // Several stops approximating a Gaussian falloff; a two-stop gradient
  // shows banding rings when the sprite is drawn large (haze blobs).
  const g = ctx.createRadialGradient(half, half, 0, half, half, half)
  g.addColorStop(0, rgba(color, 1))
  g.addColorStop(0.25, rgba(color, 0.65))
  g.addColorStop(0.5, rgba(color, 0.3))
  g.addColorStop(0.75, rgba(color, 0.1))
  g.addColorStop(1, rgba(color, 0))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE)
  return canvas
}

class SpriteCache {
  private readonly cache = new Map<string, HTMLCanvasElement>()

  get(color: Rgb): HTMLCanvasElement {
    // Quantized so slowly blending colors don't thrash the cache.
    const key = `${(color[0] / 6) | 0},${(color[1] / 6) | 0},${(color[2] / 6) | 0}`
    let sprite = this.cache.get(key)
    if (!sprite) {
      if (this.cache.size > 32) this.cache.clear()
      sprite = makeSprite(color)
      this.cache.set(key, sprite)
    }
    return sprite
  }
}

function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  x: number,
  y: number,
  size: number,
  alpha: number,
): void {
  if (alpha < 0.004 || size <= 0) return
  ctx.globalAlpha = Math.min(1, alpha)
  ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size)
}

// --- drift: the step 2 look, used only for neutral --------------------------

interface DriftParticle {
  x: number
  y: number
  angle: number
  speed: number
  size: number
  phase: number
  trail: TrailBuffer
}

class DriftRenderer implements MotifRenderer {
  private readonly particles: DriftParticle[] = []
  private sampleTimer = 0

  constructor(random: Random) {
    for (let i = 0; i < SCENE.particleCount; i++) {
      this.particles.push({
        x: random(),
        y: random(),
        angle: random() * Math.PI * 2,
        speed: 0.5 + random(),
        size: 1 + random() * 2,
        phase: random() * Math.PI * 2,
        trail: new TrailBuffer(TRAIL.points),
      })
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    view: View,
    frame: AudioFrame,
    params: SceneParams,
    dt: number,
    alpha: number,
    boost: number,
    time: number,
  ): void {
    const { w, h } = view
    const minDim = Math.min(w, h)
    const kick = accentKick(frame, params, boost)
    const glowMul = accentMul(EMPHASIS.glow, params.accent)
    const sizeMul = accentMul(EMPHASIS.size, params.accent)

    // Central glow: swells with bass, kicks on beat, breathes when idle.
    const breath = Math.sin(time * SCENE.breathRate) * SCENE.breathAmount
    const glowR =
      minDim *
      (SCENE.glowBase + breath + frame.bass * SCENE.glowBass + kick * SCENE.glowBeat) *
      params.glowScale
    const cx = w / 2
    const cy = h / 2
    const glowAlpha =
      (SCENE.glowAlphaBase + frame.bass * SCENE.glowAlphaBass) * glowMul * alpha
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR)
    gradient.addColorStop(0, rgba(params.glowColor, glowAlpha))
    gradient.addColorStop(1, rgba(params.glowColor, 0))
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2)
    ctx.fill()

    // Beat accent: a ring that spreads and fades as the pulse decays.
    if (frame.beat > 0.02) {
      const ringR = glowR * (1 + (1 - frame.beat) * SCENE.ringSpread)
      ctx.strokeStyle = rgba(params.ringColor, Math.min(1, kick * SCENE.ringAlpha) * alpha)
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2)
      ctx.stroke()
    }

    const count = Math.min(this.particles.length, Math.max(0, Math.round(params.particleCount)))
    const drive = (SCENE.idleSpeed + frame.level * SCENE.levelSpeed) * params.speed
    const wander = (SCENE.wanderIdle + frame.mid * SCENE.wanderMid) * params.jitter
    const biasY = -params.lift * SCENE.liftBias
    this.sampleTimer += dt
    const sample = this.sampleTimer >= TRAIL.spacingSec
    if (sample) this.sampleTimer -= TRAIL.spacingSec
    for (let i = 0; i < count; i++) {
      const p = this.particles[i]
      p.angle += Math.sin(time * SCENE.wanderRate + p.phase) * wander * dt
      p.x += Math.cos(p.angle) * drive * p.speed * dt
      p.y += Math.sin(p.angle) * drive * p.speed * dt + biasY * dt
      if (p.x < 0 || p.x > 1) {
        p.x = ((p.x % 1) + 1) % 1
        p.trail.clear()
      }
      if (p.y < 0 || p.y > 1) {
        p.y = ((p.y % 1) + 1) % 1
        p.trail.clear()
      }
      if (sample) p.trail.push(p.x, p.y)

      const twinkle = 0.5 + 0.5 * Math.sin(time * SCENE.twinkleRate + p.phase * 7)
      const a =
        Math.min(
          1,
          SCENE.particleAlphaBase +
            frame.level * SCENE.particleAlphaLevel +
            twinkle * (0.2 + 0.8 * frame.high) * SCENE.particleAlphaHigh,
        ) * alpha
      const size = p.size * sizeMul * (1 + Math.min(1, kick) * SCENE.particleBeatSize)
      ctx.fillStyle = rgba(params.particleColor, a)
      ctx.beginPath()
      ctx.arc(p.x * w, p.y * h, size, 0, Math.PI * 2)
      ctx.fill()
    }
    drawTrails(
      ctx,
      view,
      this.particles,
      count,
      params.particleColor,
      TRAIL.alpha * (0.3 + 0.7 * frame.level) * alpha,
      2.2 * sizeMul,
    )
    ctx.globalAlpha = 1
  }
}

// --- embers: rise from the bottom, flicker, cool as they climb --------------

interface Ember {
  x: number
  y: number
  depth: number
  size: number
  phase: number
  swayPhase: number
  trail: TrailBuffer
}

class EmbersRenderer implements MotifRenderer {
  private readonly embers: Ember[] = []
  private readonly sprites = new SpriteCache()
  private readonly random: Random
  private sampleTimer = 0

  constructor(random: Random) {
    this.random = random
    for (let i = 0; i < EMBERS.count; i++) {
      this.embers.push({
        x: random(),
        y: random(),
        depth: i % 3,
        size: EMBERS.sizeMin + random() * (EMBERS.sizeMax - EMBERS.sizeMin),
        phase: random() * Math.PI * 2,
        swayPhase: random() * Math.PI * 2,
        trail: new TrailBuffer(TRAIL.points),
      })
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    view: View,
    frame: AudioFrame,
    params: SceneParams,
    dt: number,
    alpha: number,
    boost: number,
    time: number,
  ): void {
    const { w, h } = view
    const minDim = Math.min(w, h)
    const px = minDim / 720
    const kick = accentKick(frame, params, boost)
    const glowMul = accentMul(EMPHASIS.glow, params.accent)
    const sizeMul = accentMul(EMPHASIS.size, params.accent)
    const hot = this.sprites.get(params.glowColor)
    const cool = this.sprites.get(params.particleColor)
    const rise =
      (EMBERS.riseSpeed + frame.level * EMBERS.riseLevel) * params.speed * (1 + kick * 0.4)
    this.sampleTimer += dt
    const sample = this.sampleTimer >= TRAIL.spacingSec
    if (sample) this.sampleTimer -= TRAIL.spacingSec

    for (const e of this.embers) {
      const depthSpeed = EMBERS.depthSpeed[e.depth]
      e.y -= rise * depthSpeed * dt
      e.x +=
        Math.sin(time * EMBERS.swayRate * params.jitter + e.swayPhase) *
        EMBERS.sway *
        depthSpeed *
        dt *
        params.jitter
      if (e.x < 0 || e.x > 1) {
        e.x = ((e.x % 1) + 1) % 1
        e.trail.clear()
      }
      if (e.y < -0.06) {
        e.y = 1.04
        e.x = this.random()
        e.trail.clear()
      }
      if (sample) e.trail.push(e.x, e.y)

      const heat = Math.max(0, Math.min(1, e.y)) // hot at the bottom
      const topFade = Math.max(0, Math.min(1, e.y * 5 + 0.15)) // die out near the top
      const flicker =
        0.7 + 0.3 * Math.sin(time * EMBERS.flickerRate * params.jitter + e.phase)
      const a =
        (EMBERS.alphaBase + frame.level * EMBERS.alphaLevel) *
        EMBERS.depthAlpha[e.depth] *
        flicker *
        topFade *
        alpha
      const size =
        e.size * EMBERS.depthSize[e.depth] * sizeMul * (1 + kick * 0.3) * px * 4
      const sx = e.x * w
      const sy = e.y * h
      drawSprite(ctx, hot, sx, sy, size, a * heat)
      drawSprite(ctx, cool, sx, sy, size * 0.8, a * (1 - heat))
    }
    ctx.globalAlpha = 1
    drawTrails(
      ctx,
      view,
      this.embers,
      this.embers.length,
      params.glowColor,
      1.4 * TRAIL.alpha * (EMBERS.alphaBase + frame.level * EMBERS.alphaLevel) * alpha,
      3.2 * sizeMul * px,
    )

    // Heat bed along the bottom edge.
    const bedAlpha =
      (EMBERS.bedAlpha + frame.bass * EMBERS.bedBass * glowMul + kick * EMBERS.bedKick) * alpha
    const bedTop = h * (1 - EMBERS.bedHeight)
    const bed = ctx.createLinearGradient(0, bedTop, 0, h)
    bed.addColorStop(0, rgba(params.glowColor, 0))
    bed.addColorStop(1, rgba(params.glowColor, bedAlpha))
    ctx.fillStyle = bed
    ctx.fillRect(0, bedTop, w, h - bedTop)
  }
}

// --- rain: long angled streaks in depth layers -------------------------------

interface Drop {
  x: number
  y: number
}

class RainRenderer implements MotifRenderer {
  /** One array per depth layer so each layer strokes as a single path. */
  private readonly layers: Drop[][] = [[], [], []]
  private readonly random: Random

  constructor(random: Random) {
    this.random = random
    for (let i = 0; i < RAIN.count; i++) {
      this.layers[i % 3].push({ x: random(), y: random() })
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    view: View,
    frame: AudioFrame,
    params: SceneParams,
    dt: number,
    alpha: number,
    boost: number,
    _time: number,
  ): void {
    const { w, h } = view
    const minDim = Math.min(w, h)
    const px = minDim / 720
    const kick = accentKick(frame, params, boost)
    const glowMul = accentMul(EMPHASIS.glow, params.accent)
    const sizeMul = accentMul(EMPHASIS.size, params.accent)
    const fall = (RAIN.fallSpeed + frame.level * RAIN.fallLevel) * params.speed
    const dirX = Math.sin(RAIN.tilt)
    const dirY = Math.cos(RAIN.tilt)

    // Dim glow high up.
    const topAlpha = (RAIN.topGlowAlpha + frame.bass * RAIN.topGlowBass) * glowMul * alpha
    const top = ctx.createLinearGradient(0, 0, 0, h * RAIN.topGlowHeight)
    top.addColorStop(0, rgba(params.glowColor, topAlpha))
    top.addColorStop(1, rgba(params.glowColor, 0))
    ctx.fillStyle = top
    ctx.fillRect(0, 0, w, h * RAIN.topGlowHeight)

    for (let depth = 0; depth < 3; depth++) {
      const speed = fall * RAIN.depthSpeed[depth]
      const len = speed * RAIN.lengthFactor * h
      const stepX = (dirX * speed * h * dt) / w
      const stepY = dirY * speed * dt
      const a =
        RAIN.depthAlpha[depth] * (0.45 + frame.level * RAIN.alphaLevel + kick * RAIN.alphaKick) * alpha
      ctx.strokeStyle = rgba(params.particleColor, a)
      ctx.lineWidth = RAIN.depthWidth[depth] * sizeMul * px
      ctx.beginPath()
      for (const d of this.layers[depth]) {
        d.x += stepX
        d.y += stepY
        if (d.y > 1.05) {
          d.y -= 1.12
          d.x = this.random()
        }
        if (d.x > 1.02) d.x -= 1.04
        const x = d.x * w
        const y = d.y * h
        ctx.moveTo(x - dirX * len, y - dirY * len)
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }
}

// --- stars: a fixed field with slow parallax and high-driven twinkle ---------

interface Star {
  x: number
  y: number
  depth: number
  size: number
  phase: number
  bright: boolean
}

class StarsRenderer implements MotifRenderer {
  private readonly stars: Star[] = []
  private readonly offsets = [0, 0, 0]
  private readonly sprites = new SpriteCache()

  constructor(random: Random) {
    for (let i = 0; i < STARS.count; i++) {
      this.stars.push({
        x: random(),
        y: random(),
        depth: i % 3,
        size: STARS.sizeMin + random() * (STARS.sizeMax - STARS.sizeMin),
        phase: random() * Math.PI * 2,
        bright: i % STARS.brightEvery === 0,
      })
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    view: View,
    frame: AudioFrame,
    params: SceneParams,
    dt: number,
    alpha: number,
    boost: number,
    time: number,
  ): void {
    const { w, h } = view
    const minDim = Math.min(w, h)
    const px = minDim / 720
    const kick = accentKick(frame, params, boost)
    const glowMul = accentMul(EMPHASIS.glow, params.accent)
    const sizeMul = accentMul(EMPHASIS.size, params.accent)
    const sprite = this.sprites.get(params.particleColor)

    for (let depth = 0; depth < 3; depth++) {
      this.offsets[depth] += STARS.parallax * ((depth + 1) / 3) * params.speed * dt
    }

    const amp = STARS.twinkleBase + STARS.twinkleHigh * frame.high
    for (const s of this.stars) {
      const x = (((s.x + this.offsets[s.depth]) % 1) + 1) % 1
      const tw = 1 - amp * (0.5 + 0.5 * Math.sin(time * STARS.twinkleRate * params.jitter + s.phase))
      const a = STARS.depthAlpha[s.depth] * tw * (0.55 + 0.45 * frame.level) * alpha
      const size =
        s.size * STARS.depthSize[s.depth] * (s.bright ? STARS.brightSize : 1) * sizeMul * px * 3
      drawSprite(ctx, sprite, x * w, s.y * h, size, a)
    }
    ctx.globalAlpha = 1

    // Soft horizon glow.
    const horizonAlpha =
      (STARS.horizonAlpha + frame.bass * STARS.horizonBass * glowMul + kick * STARS.horizonKick) *
      alpha
    const r = STARS.horizonRadius * minDim * params.glowScale
    const cy = h * 1.05
    const grad = ctx.createRadialGradient(w / 2, cy, 0, w / 2, cy, r)
    grad.addColorStop(0, rgba(params.glowColor, horizonAlpha))
    grad.addColorStop(1, rgba(params.glowColor, 0))
    ctx.fillStyle = grad
    ctx.fillRect(0, h - r, w, r)
  }
}

// --- haze: large soft drifting blobs and blurred bokeh lights ----------------

interface Blob {
  x: number
  y: number
  angle: number
  size: number
  phase: number
}

class HazeRenderer implements MotifRenderer {
  private readonly blobs: Blob[] = []
  private readonly lights: Blob[] = []
  private readonly sprites = new SpriteCache()

  constructor(random: Random) {
    for (let i = 0; i < HAZE.blobCount; i++) {
      this.blobs.push({
        x: random(),
        y: random(),
        angle: random() * Math.PI * 2,
        size: HAZE.blobSizeMin + random() * (HAZE.blobSizeMax - HAZE.blobSizeMin),
        phase: random() * Math.PI * 2,
      })
    }
    for (let i = 0; i < HAZE.lightCount; i++) {
      this.lights.push({
        x: random(),
        y: random(),
        angle: random() * Math.PI * 2,
        size: HAZE.lightSizeMin + random() * (HAZE.lightSizeMax - HAZE.lightSizeMin),
        phase: random() * Math.PI * 2,
      })
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    view: View,
    frame: AudioFrame,
    params: SceneParams,
    dt: number,
    alpha: number,
    boost: number,
    time: number,
  ): void {
    const { w, h } = view
    const minDim = Math.min(w, h)
    const kick = accentKick(frame, params, boost)
    const sizeMul = accentMul(EMPHASIS.size, params.accent)
    const glowMul = accentMul(EMPHASIS.glow, params.accent)
    const blobSprite = this.sprites.get(params.glowColor)
    const lightSprite = this.sprites.get(params.ringColor)

    for (const b of this.blobs) {
      b.angle += Math.sin(time * 0.4 * params.jitter + b.phase) * 0.5 * params.jitter * dt
      b.x += Math.cos(b.angle) * HAZE.blobSpeed * params.speed * dt
      b.y += Math.sin(b.angle) * HAZE.blobSpeed * params.speed * dt - params.lift * SCENE.liftBias * 0.5 * dt
      if (b.x < 0 || b.x > 1) b.x = ((b.x % 1) + 1) % 1
      if (b.y < 0 || b.y > 1) b.y = ((b.y % 1) + 1) % 1
      const a =
        (HAZE.blobAlpha + frame.level * HAZE.blobLevel + kick * HAZE.blobKick) * glowMul * alpha
      const size = b.size * minDim * (1 + frame.bass * 0.15)
      drawSprite(ctx, blobSprite, b.x * w, b.y * h, size, a)
    }

    for (const l of this.lights) {
      l.angle += Math.sin(time * 0.6 * params.jitter + l.phase) * 0.8 * params.jitter * dt
      l.x += Math.cos(l.angle) * HAZE.lightSpeed * params.speed * dt
      l.y += Math.sin(l.angle) * HAZE.lightSpeed * params.speed * dt
      if (l.x < 0 || l.x > 1) l.x = ((l.x % 1) + 1) % 1
      if (l.y < 0 || l.y > 1) l.y = ((l.y % 1) + 1) % 1
      const tw = 0.5 + 0.5 * Math.sin(time * HAZE.twinkleRate + l.phase * 3)
      const a =
        (HAZE.lightAlpha + frame.level * HAZE.lightLevel + tw * frame.high * HAZE.lightTwinkle) *
        alpha
      const size = l.size * minDim * sizeMul * (1 + kick * 0.25) * 3
      drawSprite(ctx, lightSprite, l.x * w, l.y * h, size, a)
    }
    ctx.globalAlpha = 1
  }
}

export function createRenderers(random: Random): Record<Motif, MotifRenderer> {
  return {
    drift: new DriftRenderer(random),
    embers: new EmbersRenderer(random),
    rain: new RainRenderer(random),
    stars: new StarsRenderer(random),
    haze: new HazeRenderer(random),
  }
}
