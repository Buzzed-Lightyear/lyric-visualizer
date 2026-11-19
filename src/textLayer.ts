/**
 * Physics-driven kinetic typography on a Canvas 2D layer. Words are
 * spring bodies (src/springs.ts) moved by behaviors (src/behaviors.ts)
 * in home slots from src/layout.ts, entering at estimated onsets
 * (src/onsets.ts). Driven only by (AudioFrame, TextParams, dt) plus the
 * current line; seeded and fixed-step friendly like the scene. Also owns
 * the scrim + tint overlay that keeps text readable over the background.
 */

import type { AudioFrame } from './audioMath'
import { BEHAVIORS, sharedForces, type BehaviorName, type ExitMotion } from './behaviors'
import { layoutLine } from './layout'
import type { Rgb, TextParams } from './mapping'
import { rgba } from './motifs'
import { estimateWordOnsets } from './onsets'
import type { Random } from './random'
import { advance, newBody, type Body, type Forces, type Home } from './springs'
import { BEHAVIOR, LEGIBILITY, TEXT } from './tuning'

export interface TextLine {
  index: number
  text: string
  start: number
  end: number
}

export interface TextInput {
  params: TextParams
  /** Null = no text (toggled off, instrumental gap, before the first line). */
  line: TextLine | null
  /** Song time in seconds. */
  time: number
  /** 1-5 audition override; null = the mood mapping decides. */
  behaviorOverride: BehaviorName | null
}

interface WordStyle {
  heavy: boolean
  tracking: number
  fill: Rgb
}

interface Word {
  text: string
  /** Slot center in window fractions. */
  slotX: number
  slotY: number
  wPx: number
  fontSize: number
  onset: number
  phase: number
  entered: boolean
  body: Body
  home: Home
}

interface OutgoingLine {
  words: Word[]
  motions: ExitMotion[]
  style: WordStyle
  behavior: BehaviorName
  start: number
}

interface Letter {
  char: string
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vrot: number
  fontSize: number
  style: WordStyle
  start: number
}

/** Introspection for the harness's measured legibility checks. */
export interface WordState {
  entered: boolean
  onset: number
  rotDeg: number
  xPx: number
  yPx: number
  slotXPx: number
  slotYPx: number
  wPx: number
  hPx: number
  fontSize: number
}

type Ctx = CanvasRenderingContext2D & { letterSpacing: string }

export class TextLayer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: Ctx
  private readonly rng: Random
  private readonly view = { w: 1, h: 1 }
  private readonly forces: Forces = { ax: 0, ay: 0, aRot: 0, aScale: 0 }
  private currentIndex = -1
  private words: Word[] = []
  private outgoing: OutgoingLine | null = null
  private letters: Letter[] = []
  private currentEmphasis = 0.5
  private currentStyle: WordStyle = { heavy: false, tracking: 0.08, fill: [232, 238, 248] }
  private currentBehavior: BehaviorName = 'float'
  private lastLine: TextLine | null = null
  private lastBeat = 0

  constructor(canvas: HTMLCanvasElement, rng: Random) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is unavailable')
    this.ctx = ctx as Ctx
    this.rng = rng
  }

  get context(): CanvasRenderingContext2D {
    return this.ctx
  }

  resize(width: number, height: number, dpr: number): void {
    this.view.w = width
    this.view.h = height
    this.canvas.width = Math.round(width * dpr)
    this.canvas.height = Math.round(height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  draw(frame: AudioFrame, input: TextInput, dt: number): void {
    const { ctx } = this
    const { w, h } = this.view
    const params = input.params
    ctx.clearRect(0, 0, w, h)

    // Scrim + palette tint keep text readable over any background.
    ctx.fillStyle = `rgba(0, 0, 0, ${params.scrim})`
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = rgba(params.tint, TEXT.tintStrength)
    ctx.fillRect(0, 0, w, h)

    const lineIndex = input.line?.index ?? -1
    if (lineIndex !== this.currentIndex || input.line?.text !== this.lastLine?.text) {
      this.beginExit(input.time)
      this.currentIndex = lineIndex
      this.buildLine(input.line, params)
    }
    this.currentEmphasis = params.emphasis
    this.currentStyle = { heavy: params.heavy, tracking: params.tracking, fill: params.fill }
    const behaviorName = input.behaviorOverride ?? params.behavior
    this.currentBehavior = behaviorName
    const behavior = BEHAVIORS[behaviorName]

    const beatOnset = frame.beat >= 0.95 && this.lastBeat < 0.95
    this.lastBeat = frame.beat

    for (const word of this.words) {
      if (!word.entered) {
        if (input.time < word.onset) continue
        word.entered = true
        behavior.enter(word.body, word.slotX, word.slotY, this.rng, 0.5 + params.emphasis)
      }
      const f = this.forces
      f.ax = 0
      f.ay = 0
      f.aRot = 0
      f.aScale = 0
      behavior.forces(f, frame, input.time, word.phase, params.forceScale)
      sharedForces(f, frame, input.time, word.phase)
      f.ax *= params.forceScale
      f.ay *= params.forceScale
      f.aRot *= params.forceScale
      if (beatOnset) {
        behavior.onBeat(word.body, this.rng, params.forceScale * (0.5 + params.emphasis))
      }
      word.home.scale = 1 + frame.bass * TEXT.bassScale
      advance(word.body, word.home, behavior.spring(), f, dt, behavior.floor?.(word.slotY))
      if (input.time >= word.onset + LEGIBILITY.settleSec) this.clampLegible(word)
    }

    this.stepOutgoing(input.time, dt)
    this.stepLetters(input.time, dt)

    this.drawOutgoing(input.time)
    this.drawLetters(input.time)
    this.drawCurrent(input.time, params)
  }

  /** Hard legibility: upright, near its slot, on screen, sane scale. */
  private clampLegible(word: Word): void {
    const b = word.body
    const maxTilt = (LEGIBILITY.maxTiltDeg * Math.PI) / 180
    if (b.rot > maxTilt) {
      b.rot = maxTilt
      b.vrot = Math.min(b.vrot, 0)
    } else if (b.rot < -maxTilt) {
      b.rot = -maxTilt
      b.vrot = Math.max(b.vrot, 0)
    }
    const tolX = (LEGIBILITY.slotTolFrac * word.fontSize) / this.view.w
    const tolY = (LEGIBILITY.slotTolFrac * word.fontSize) / this.view.h
    if (b.x > word.slotX + tolX) {
      b.x = word.slotX + tolX
      b.vx = Math.min(b.vx, 0)
    } else if (b.x < word.slotX - tolX) {
      b.x = word.slotX - tolX
      b.vx = Math.max(b.vx, 0)
    }
    if (b.y > word.slotY + tolY) {
      b.y = word.slotY + tolY
      b.vy = Math.min(b.vy, 0)
    } else if (b.y < word.slotY - tolY) {
      b.y = word.slotY - tolY
      b.vy = Math.max(b.vy, 0)
    }
    b.scale = Math.max(0.7, Math.min(1.5, b.scale))
  }

  private buildLine(line: TextLine | null, params: TextParams): void {
    this.words = []
    this.lastLine = line
    if (!line) return
    const raw = line.text.split(/\s+/).filter(Boolean)
    if (raw.length === 0) return
    const texts = raw.map((word) => (params.caps ? word.toUpperCase() : word))
    const { w, h } = this.view
    const measure = (text: string, size: number): number => {
      this.setFont(size, params.heavy, params.tracking)
      return this.ctx.measureText(text).width
    }
    const { slots, fontSize } = layoutLine(texts, w, h, measure, params.sizeScale)
    const onsets = estimateWordOnsets(texts, line.start, line.end - line.start)
    slots.forEach((slot, i) => {
      const x = slot.x / w
      const y = slot.y / h
      this.words.push({
        text: slot.text,
        slotX: x,
        slotY: y,
        wPx: slot.w,
        fontSize,
        onset: onsets[i],
        phase: this.rng() * Math.PI * 2,
        entered: false,
        body: newBody(x, y),
        home: { x, y, rot: 0, scale: 1 },
      })
    })
  }

  private beginExit(time: number): void {
    const entered = this.words.filter((word) => word.entered)
    if (entered.length === 0) {
      this.words = []
      return
    }
    if (this.currentEmphasis >= TEXT.shatterEmphasis) {
      this.shatterWords(entered, time)
      this.outgoing = null
    } else {
      const behavior = BEHAVIORS[this.currentBehavior]
      const motions = entered.map(() => behavior.exit(this.rng, 1))
      entered.forEach((word, i) => {
        word.body.vx += motions[i].vx
        word.body.vy += motions[i].vy
        word.body.vrot += motions[i].spin
      })
      this.outgoing = {
        words: entered,
        motions,
        style: this.currentStyle,
        behavior: this.currentBehavior,
        start: time,
      }
    }
    this.words = []
  }

  private shatterWords(words: Word[], time: number): void {
    this.letters = []
    const { w } = this.view
    for (const word of words) {
      const chars = [...word.text]
      const letterW = word.wPx / Math.max(1, chars.length) / w
      chars.forEach((char, i) => {
        const x = word.body.x - (word.wPx / 2 / w) + letterW * (i + 0.5)
        this.letters.push({
          char,
          x,
          y: word.body.y,
          vx: (x - 0.5) * BEHAVIOR.shatter.spreadX * 2 + (this.rng() - 0.5) * 0.2,
          vy: -(0.08 + this.rng() * BEHAVIOR.shatter.spreadY),
          rot: word.body.rot,
          vrot: (this.rng() - 0.5) * BEHAVIOR.shatter.spin,
          fontSize: word.fontSize,
          style: this.currentStyle,
          start: time,
        })
      })
    }
  }

  private stepOutgoing(time: number, dt: number): void {
    const out = this.outgoing
    if (!out) return
    const elapsed = time - out.start
    if (elapsed < 0 || elapsed > TEXT.exitSec) {
      this.outgoing = null
      return
    }
    out.words.forEach((word, i) => {
      const b = word.body
      b.vy += out.motions[i].gravity * dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.rot += b.vrot * dt
    })
  }

  private stepLetters(time: number, dt: number): void {
    this.letters = this.letters.filter((l) => {
      const elapsed = time - l.start
      if (elapsed < 0 || elapsed > BEHAVIOR.shatter.fadeSec) return false
      l.vy += BEHAVIOR.shatter.gravity * dt
      l.x += l.vx * dt
      l.y += l.vy * dt
      l.rot += l.vrot * dt
      return true
    })
  }

  private drawCurrent(time: number, params: TextParams): void {
    // The word at or nearest after its onset gets the accent color.
    let active = -1
    this.words.forEach((word, i) => {
      if (word.entered && word.onset <= time) active = i
    })
    this.words.forEach((word, i) => {
      if (!word.entered) return
      const fill = i === active ? params.accent : params.fill
      this.drawWord(
        word,
        { heavy: params.heavy, tracking: params.tracking, fill },
        1,
        this.currentBehavior === 'swing',
      )
    })
  }

  private drawOutgoing(time: number): void {
    const out = this.outgoing
    if (!out) return
    const alpha = Math.max(0, 1 - (time - out.start) / TEXT.exitSec)
    for (const word of out.words) {
      this.drawWord(word, out.style, alpha, out.behavior === 'swing')
    }
  }

  private drawLetters(time: number): void {
    const { ctx } = this
    const { w, h } = this.view
    for (const l of this.letters) {
      const alpha = Math.max(0, 1 - (time - l.start) / BEHAVIOR.shatter.fadeSec)
      ctx.save()
      ctx.translate(l.x * w, l.y * h)
      ctx.rotate(l.rot)
      this.setFont(l.fontSize, l.style.heavy, l.style.tracking)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = rgba(l.style.fill, alpha)
      ctx.fillText(l.char, 0, 0)
      ctx.restore()
    }
  }

  private drawWord(word: Word, style: WordStyle, alpha: number, swingPivot: boolean): void {
    const { ctx } = this
    const { w, h } = this.view
    const b = word.body
    ctx.save()
    ctx.translate(b.x * w, b.y * h)
    if (swingPivot) {
      // Hang from a pivot above the word so rotation reads as a pendulum.
      const pivot = word.fontSize * 0.9
      ctx.translate(0, -pivot)
      ctx.rotate(b.rot)
      ctx.translate(0, pivot)
    } else {
      ctx.rotate(b.rot)
    }
    ctx.scale(b.scale, b.scale)
    this.setFont(word.fontSize, style.heavy, style.tracking)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = rgba(style.fill, alpha)
    ctx.fillText(word.text, 0, 0)
    ctx.restore()
  }

  private setFont(sizePx: number, heavy: boolean, tracking: number): void {
    const family = heavy ? '"Archivo Black", system-ui, sans-serif' : '"Inter", system-ui, sans-serif'
    this.ctx.font = `${heavy ? 400 : 300} ${sizePx}px ${family}`
    this.ctx.letterSpacing = `${(tracking * sizePx).toFixed(2)}px`
  }

  /** For the harness's measured legibility checks. */
  inspect(): { lineCount: number; words: WordState[] } {
    const { w, h } = this.view
    return {
      lineCount:
        (this.words.some((word) => word.entered) ? 1 : 0) +
        (this.outgoing ? 1 : 0) +
        (this.letters.length > 0 ? 1 : 0),
      words: this.words.map((word) => ({
        entered: word.entered,
        onset: word.onset,
        rotDeg: (word.body.rot * 180) / Math.PI,
        xPx: word.body.x * w,
        yPx: word.body.y * h,
        slotXPx: word.slotX * w,
        slotYPx: word.slotY * h,
        wPx: word.wPx,
        hPx: word.fontSize,
        fontSize: word.fontSize,
      })),
    }
  }
}
