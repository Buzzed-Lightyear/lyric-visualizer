/**
 * Physics-driven kinetic typography. Words are spring bodies in home
 * slots; an entrance part sets how they arrive, a hold part moves them
 * while active, an exit part takes the line out. Letter-level bodies are
 * used where a part needs them (pop, assemble, wave, shatter); words
 * stay the unit for layout. A legibility assist spring ramps in before
 * the settle deadline instead of a hard clamp. Seeded and fixed-step
 * friendly; driven only by (AudioFrame, TextParams, dt) plus the line.
 */

import type { AudioFrame } from './audioMath'
import { GESTURES, type GestureAssignment } from './gestures'
import { focusFeasible, LAYOUTS, type AnchorName, type LayoutName } from './layout'
import type { Rgb, TextParams } from './mapping'
import { rgba } from './motifs'
import { estimateWordOnsets } from './onsets'
import {
  ENTRANCES,
  EXITS,
  HOLDS,
  sharedForces,
  type Entrance,
  type EntranceName,
  type ExitMotion,
  type ExitName,
  type Hold,
  type HoldName,
} from './parts'
import type { Random } from './random'
import { advance, newBody, type Body, type Forces, type Home, type SpringConfig } from './springs'
import { ASSIST, EXIT_T, GESTURE_T, HOLD_T, LEGIBILITY, TEXT, TYPESET } from './tuning'
import { allFontsLoaded, fontString, makeMeasure, typeStyleFor, VOICES, type VoiceName } from './voices'

export interface TextLine {
  index: number
  text: string
  start: number
  end: number
}

export interface PartOverrides {
  entrance?: EntranceName | null
  hold?: HoldName | null
  exit?: ExitName | null
  voice?: VoiceName | null
  layout?: LayoutName | null
}

export interface TextInput {
  params: TextParams
  /** Null = no text (toggled off, instrumental gap, before the first line). */
  line: TextLine | null
  /** Song time in seconds. */
  time: number
  /** Audition overrides; null/undefined = the mapping decides. */
  overrides: PartOverrides
}

/** Tripwire: counts any glyph drawn before every face was loaded. */
export const fontGate = { violations: 0 }

interface Letter {
  char: string
  body: Body
  home: Home
  /** Width in px (for shatter velocity spread). */
  wPx: number
  delay: number
}

interface Word {
  text: string
  /** Index in the original line's words. */
  index: number
  slotX: number
  slotY: number
  wPx: number
  fontSize: number
  onset: number
  phase: number
  entered: boolean
  body: Body
  home: Home
  letters: Letter[] | null
  /** Hierarchy focus word: larger, heavier. */
  focusWord: boolean
  /** The gesture this word performs, or null for the base motion. */
  gesture: GestureAssignment | null
  /** Focus layout: when this word hands over to the next. */
  focusExitAt: number | null
  /** Focus hand-over fade started at. */
  exitedAt: number | null
  squash: number
  prevX: number
  prevY: number
}

interface LineParts {
  entrance: EntranceName
  hold: HoldName
  exit: ExitName
  voice: VoiceName
  layout: LayoutName
  anchor: AnchorName
  fill: Rgb
  accent: Rgb
}

/** The parts one word actually runs: the line's, or its gesture's. */
interface WordParts {
  entrance: Entrance
  hold: Hold
  holdName: HoldName
  force: number
  strength: number
  scaleBias: number
  letterSpread: number
  echo: number
}

interface OutWord {
  word: Word
  motion: ExitMotion
}

interface OutgoingLine {
  words: OutWord[]
  parts: LineParts
  start: number
  snap: boolean
}

interface ShatterLetter {
  char: string
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vrot: number
  fontSize: number
  voice: VoiceName
  fill: Rgb
  start: number
}

export interface WordState {
  entered: boolean
  exiting: boolean
  onset: number
  rotDeg: number
  xPx: number
  yPx: number
  slotXPx: number
  slotYPx: number
  wPx: number
  hPx: number
  fontSize: number
  /** Worst letter deviation from its own home (0 in word mode). */
  letterMaxOffsetPx: number
  letterMaxTiltDeg: number
}

type Ctx = CanvasRenderingContext2D & { letterSpacing: string }

const FOCUS_FADE_SEC = 0.2

export class TextLayer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: Ctx
  private readonly rng: Random
  private readonly view = { w: 1, h: 1 }
  private readonly forces: Forces = { ax: 0, ay: 0, aRot: 0, aScale: 0 }
  private fontsReady = false
  private currentIndex = -1
  private words: Word[] = []
  private parts: LineParts | null = null
  private outgoing: OutgoingLine | null = null
  private shatter: ShatterLetter[] = []
  private lastLine: TextLine | null = null
  private lastBeat = 0
  private waveBoost = 0

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

  draw(frame: AudioFrame, input: TextInput, dt: number, render = true): void {
    const { ctx } = this
    const { w, h } = this.view
    const params = input.params
    if (render) {
      ctx.clearRect(0, 0, w, h)
      // Scrim + palette tint keep text readable over any background.
      ctx.fillStyle = `rgba(0, 0, 0, ${params.scrim})`
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = rgba(params.tint, TEXT.tintStrength)
      ctx.fillRect(0, 0, w, h)
    }

    // Nothing draws text until every face is loaded.
    if (!this.fontsReady) this.fontsReady = allFontsLoaded()
    if (!this.fontsReady) return

    const lineIndex = input.line?.index ?? -1
    if (lineIndex !== this.currentIndex || input.line?.text !== this.lastLine?.text) {
      this.switchLine(input, params)
    }

    const parts = this.effectiveParts(input)
    const beatOnset = frame.beat >= 0.95 && this.lastBeat < 0.95
    this.lastBeat = frame.beat
    this.waveBoost *= Math.exp(-HOLD_T.wave.boostDecay * dt)
    if (beatOnset) this.waveBoost = HOLD_T.wave.beatBoost

    if (parts) this.stepCurrent(frame, input, parts, beatOnset, dt)
    this.stepOutgoing(input.time, dt, beatOnset)
    this.stepShatter(input.time, dt)

    if (render) {
      this.drawOutgoing(input.time)
      this.drawShatter(input.time)
      if (parts) this.drawCurrent(input.time, params, parts)
    }
  }

  // --- line lifecycle --------------------------------------------------------

  private effectiveParts(input: TextInput): LineParts | null {
    if (!this.parts) return null
    const o = input.overrides
    return {
      entrance: o.entrance ?? this.parts.entrance,
      hold: o.hold ?? this.parts.hold,
      exit: o.exit ?? this.parts.exit,
      voice: o.voice ?? this.parts.voice,
      layout: this.parts.layout, // layout is fixed at build
      anchor: this.parts.anchor,
      fill: this.parts.fill,
      accent: this.parts.accent,
    }
  }

  /** Resolve one word's parts: its gesture's recipe, or the line's. */
  private wordParts(word: Word, parts: LineParts): WordParts {
    const g = word.gesture
    if (!g) {
      return {
        entrance: ENTRANCES[parts.entrance],
        hold: HOLDS[parts.hold],
        holdName: parts.hold,
        force: 1,
        strength: 1,
        scaleBias: 1,
        letterSpread: 1,
        echo: 0,
      }
    }
    const recipe = GESTURES[g.gesture]
    return {
      entrance: ENTRANCES[recipe.entrance],
      hold: HOLDS[recipe.hold],
      holdName: recipe.hold,
      force: recipe.force * GESTURE_T.force,
      strength: recipe.strength * GESTURE_T.strength,
      scaleBias: recipe.scaleBias,
      letterSpread: recipe.letterSpread,
      echo: recipe.echo,
    }
  }

  private switchLine(input: TextInput, params: TextParams): void {
    const oldWords = this.words.filter((word) => word.entered && word.exitedAt === null)
    const oldParts = this.parts ? { ...this.parts, exit: input.overrides.exit ?? this.parts.exit } : null
    this.currentIndex = input.line?.index ?? -1
    this.lastLine = input.line
    this.buildLine(input, params)
    if (oldWords.length > 0 && oldParts) {
      this.beginExit(oldWords, oldParts, input.time)
    }
  }

  private buildLine(input: TextInput, params: TextParams): void {
    this.words = []
    this.parts = null
    const line = input.line
    if (!line) return
    const o = input.overrides
    const voiceName = o.voice ?? params.voice
    const voice = VOICES[voiceName]
    const raw = line.text.split(/\s+/).filter(Boolean)
    if (raw.length === 0) return
    const texts = raw.map((word) => (voice.caps ? word.toUpperCase() : word))
    const { w, h } = this.view
    const measure = makeMeasure(this.ctx, voiceName)
    const style = typeStyleFor(this.ctx, voiceName)
    const onsets = estimateWordOnsets(texts, line.start, line.end - line.start)
    let layout = o.layout ?? params.layout
    if (layout === 'focus' && !focusFeasible(onsets, line.end)) layout = 'centered'
    const { slots } = LAYOUTS[layout]({
      words: texts,
      viewW: w,
      viewH: h,
      measure,
      style,
      sizeScale: params.sizeScale,
      focus: params.focus,
      anchor: params.anchor,
    })

    this.parts = {
      entrance: params.entrance,
      hold: params.hold,
      exit: params.exit,
      voice: voiceName,
      layout,
      anchor: params.anchor,
      fill: params.fill,
      accent: params.accent,
    }
    slots.forEach((slot, i) => {
      const x = slot.x / w
      const y = slot.y / h
      this.words.push({
        text: slot.text,
        index: slot.index,
        slotX: x,
        slotY: y,
        wPx: slot.w,
        fontSize: slot.h,
        onset: onsets[slot.index],
        phase: this.rng() * Math.PI * 2,
        entered: false,
        body: newBody(x, y),
        home: { x, y, rot: 0, scale: 1 },
        letters: null,
        focusWord: slot.focus,
        gesture: params.gestures.find((g) => g.index === slot.index) ?? null,
        focusExitAt:
          layout === 'focus'
            ? (i + 1 < slots.length ? onsets[slots[i + 1].index] : null)
            : null,
        exitedAt: null,
        squash: 0,
        prevX: x,
        prevY: y,
      })
    })
  }

  private ensureLetters(word: Word, voiceName: VoiceName, spread = 1): Letter[] {
    if (word.letters) return word.letters
    const { w } = this.view
    const chars = [...word.text]
    const widths = chars.map((char) => {
      this.setFont(voiceName, word.fontSize)
      return this.ctx.measureText(char).width
    })
    const total = widths.reduce((a, b) => a + b, 0)
    let cursor = -total / 2
    word.letters = chars.map((char, i) => {
      const dxPx = (cursor + widths[i] / 2) * spread
      cursor += widths[i]
      const x = word.slotX + dxPx / w
      const y = word.slotY
      return {
        char,
        body: newBody(x, y),
        home: { x, y, rot: 0, scale: 1 },
        wPx: widths[i],
        delay: 0,
      }
    })
    return word.letters
  }

  // --- stepping --------------------------------------------------------------

  /** The assist spring weight: ramps in before the settle deadline. */
  private assistWeight(time: number, onset: number): number {
    const u = (time - onset) / LEGIBILITY.settleSec
    if (u <= ASSIST.rampStart) return 0
    const t = Math.min(1, (u - ASSIST.rampStart) / (1 - ASSIST.rampStart))
    return t * t * (3 - 2 * t)
  }

  private effectiveSpring(base: SpringConfig, weight: number): SpringConfig {
    if (weight <= 0) return base
    return {
      k: base.k + weight * ASSIST.k,
      c: base.c + weight * ASSIST.c,
      kRot: base.kRot + weight * ASSIST.kRot,
      cRot: base.cRot + weight * ASSIST.cRot,
      kScale: base.kScale,
      cScale: base.cScale,
    }
  }

  private stepCurrent(
    frame: AudioFrame,
    input: TextInput,
    parts: LineParts,
    beatOnset: boolean,
    dt: number,
  ): void {
    const params = input.params
    const time = input.time
    const baseStrength = 0.5 + params.emphasis

    for (const word of this.words) {
      // Focus hand-over: the word fades out when the next one arrives.
      if (word.focusExitAt !== null && word.exitedAt === null && time >= word.focusExitAt) {
        word.exitedAt = time
      }
      if (word.exitedAt !== null) continue

      const wp = this.wordParts(word, parts)
      const { entrance, hold } = wp
      const strength = baseStrength * wp.strength
      const letterwise = hold.letterwise || wp.letterSpread !== 1

      if (!word.entered) {
        if (time < word.onset) continue
        word.entered = true
        if (entrance.letterwise || letterwise) {
          const letters = this.ensureLetters(word, parts.voice, wp.letterSpread)
          if (entrance.letterwise) {
            letters.forEach((letter, i) => {
              entrance.init(letter.body, letter.home.x, letter.home.y, this.rng, strength)
              letter.delay = entrance.letterDelay?.(i, letters.length, this.rng) ?? 0
            })
          } else {
            // Word-level entrance with a letterwise hold: compute one
            // entrance offset and move the letters as a coherent unit.
            const probe = newBody(word.slotX, word.slotY)
            entrance.init(probe, word.slotX, word.slotY, this.rng, strength)
            this.applyDirection(probe, word)
            for (const letter of letters) {
              letter.body.x = letter.home.x + (probe.x - word.slotX)
              letter.body.y = letter.home.y + (probe.y - word.slotY)
              letter.body.vx = probe.vx
              letter.body.vy = probe.vy
              letter.body.rot = probe.rot
              letter.body.scale = probe.scale
              letter.body.vscale = probe.vscale
            }
          }
        } else {
          entrance.init(word.body, word.slotX, word.slotY, this.rng, strength)
          this.applyDirection(word.body, word)
        }
      }

      const letterMode =
        (entrance.letterwise && time < word.onset + entrance.duration) || letterwise
      const assist = this.assistWeight(time, word.onset)
      const spring = this.effectiveSpring(hold.spring(), assist)
      const floor = hold.floor?.(word.slotY)
      const restScale = (1 + frame.bass * TEXT.bassScale) * wp.scaleBias

      if (letterMode && word.letters) {
        word.letters.forEach((letter, index) => {
          if (time < word.onset + letter.delay) return
          const f = this.resetForces()
          hold.forces(f, frame, time, word.phase + index * 0.7, index)
          if (wp.holdName === 'wave') {
            f.ay *= 1 + this.waveBoost
          }
          sharedForces(f, frame, time, word.phase + index)
          this.scaleForces(f, params.forceScale * wp.force)
          if (beatOnset) hold.onBeat(letter.body, this.rng, params.forceScale * strength)
          letter.home.scale = restScale
          advance(letter.body, letter.home, spring, f, dt)
        })
        // Keep the word body parked on its slot for mode hand-over.
        word.body.x = word.slotX
        word.body.y = word.slotY
      } else {
        const f = this.resetForces()
        hold.forces(f, frame, time, word.phase, 0)
        sharedForces(f, frame, time, word.phase)
        this.driftBias(f, word)
        this.scaleForces(f, params.forceScale * wp.force)
        if (beatOnset) hold.onBeat(word.body, this.rng, params.forceScale * strength)
        word.home.scale = restScale
        word.prevX = word.body.x
        word.prevY = word.body.y
        const impact = advance(word.body, word.home, spring, f, dt, floor)
        if (impact > 0) {
          word.squash = Math.min(0.5, word.squash + impact * 1.2 * TEXT.squashStretch)
        }
      }
      word.squash *= Math.exp(-8 * dt)
    }
  }

  /** Honor the line's `direction` on a sided gesture's entrance. */
  private applyDirection(b: Body, word: Word): void {
    const g = word.gesture
    if (!g?.dir || !GESTURES[g.gesture].sided) return
    if (g.dir === 'left' || g.dir === 'right') {
      // Enter from the opposite side, moving the named way.
      const side = g.dir === 'left' ? 1 : -1
      if (b.x !== word.slotX || b.vx !== 0) {
        b.x = word.slotX + side * Math.abs(b.x - word.slotX)
        b.vx = -side * Math.abs(b.vx)
      }
    } else {
      const up = g.dir === 'up' ? -1 : 1
      b.vy += up * 0.06
    }
  }

  /** A sided gesture with an up/down direction leans that way. */
  private driftBias(f: Forces, word: Word): void {
    const g = word.gesture
    if (!g?.dir || !GESTURES[g.gesture].sided) return
    if (g.dir === 'up') f.ay -= GESTURE_T.directionBias
    if (g.dir === 'down') f.ay += GESTURE_T.directionBias
    if (g.dir === 'left') f.ax -= GESTURE_T.directionBias * 0.3
    if (g.dir === 'right') f.ax += GESTURE_T.directionBias * 0.3
  }

  private resetForces(): Forces {
    const f = this.forces
    f.ax = 0
    f.ay = 0
    f.aRot = 0
    f.aScale = 0
    return f
  }

  private scaleForces(f: Forces, forceScale: number): void {
    f.ax *= forceScale
    f.ay *= forceScale
    f.aRot *= forceScale
  }

  private beginExit(oldWords: Word[], parts: LineParts, time: number): void {
    const exit = EXITS[parts.exit]
    if (parts.exit === 'shatter') {
      this.shatterWords(oldWords, parts, time)
      this.outgoing = null
      return
    }
    const newSlots = this.words.map((word) => ({ x: word.slotX, y: word.slotY }))
    const motions = exit.begin(
      oldWords.map((word) => ({ x: word.body.x, y: word.body.y })),
      this.rng,
      1,
      newSlots,
    )
    // A lingering word outstays its line's exit.
    oldWords.forEach((word, i) => {
      motions[i].delay += this.lingerOf(word)
    })
    this.outgoing = {
      words: oldWords.map((word, i) => ({ word, motion: motions[i] })),
      parts,
      start: time,
      snap: exit.snap === true,
    }
  }

  private lingerOf(word: Word): number {
    return word.gesture ? GESTURES[word.gesture.gesture].lingerSec : 0
  }

  private shatterWords(words: Word[], parts: LineParts, time: number): void {
    this.shatter = []
    const { w } = this.view
    const S = EXIT_T.shatter
    for (const word of words) {
      const chars = [...word.text]
      const letterW = word.wPx / Math.max(1, chars.length) / w
      chars.forEach((char, i) => {
        const x = word.body.x - word.wPx / 2 / w + letterW * (i + 0.5)
        this.shatter.push({
          char,
          x,
          y: word.body.y,
          vx: (x - 0.5) * S.spreadX * 2 + (this.rng() - 0.5) * 0.2,
          vy: -(0.08 + this.rng() * S.spreadY),
          rot: word.body.rot,
          vrot: (this.rng() - 0.5) * S.spin,
          fontSize: word.fontSize,
          voice: parts.voice,
          fill: parts.fill,
          start: time + this.lingerOf(word),
        })
      })
    }
  }

  private stepOutgoing(time: number, dt: number, beatOnset: boolean): void {
    const out = this.outgoing
    if (!out) return
    const elapsed = time - out.start
    if (out.snap) {
      // Hard cut on the next beat (an intended cut), or after a timeout.
      if (elapsed < 0 || beatOnset || elapsed > EXIT_T.snap.timeout) this.outgoing = null
      return
    }
    const maxDelay = Math.max(...out.words.map((o) => o.motion.delay))
    if (elapsed < 0 || elapsed > maxDelay + TEXT.exitSec) {
      this.outgoing = null
      return
    }
    for (const { word, motion } of out.words) {
      if (elapsed < motion.delay) continue
      if (elapsed - dt < motion.delay) {
        // The gust arrives: apply the initial impulse once.
        word.body.vx += motion.vx
        word.body.vy += motion.vy
        word.body.vrot += motion.spin
      }
      const b = word.body
      b.vy += motion.gravity * dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.rot += b.vrot * dt
      b.scale = Math.max(0.01, b.scale + motion.scaleRate * b.scale * dt)
    }
  }

  private stepShatter(time: number, dt: number): void {
    const S = EXIT_T.shatter
    this.shatter = this.shatter.filter((l) => {
      const elapsed = time - l.start
      if (elapsed > S.fadeSec) return false
      if (elapsed < 0) return true // waiting (a lingering word)
      l.vy += S.gravity * dt
      l.x += l.vx * dt
      l.y += l.vy * dt
      l.rot += l.vrot * dt
      return true
    })
  }

  // --- drawing ---------------------------------------------------------------

  private drawCurrent(time: number, _params: TextParams, parts: LineParts): void {
    let active = -1
    this.words.forEach((word, i) => {
      if (word.entered && word.exitedAt === null && word.onset <= time) active = i
    })
    this.words.forEach((word, i) => {
      if (!word.entered) return
      let alpha = 1
      if (word.exitedAt !== null) {
        alpha = 1 - (time - word.exitedAt) / FOCUS_FADE_SEC
        if (alpha <= 0) return
      }
      const wp = this.wordParts(word, parts)
      const fill = i === active ? parts.accent : parts.fill
      const bold = word.focusWord ? TYPESET.focusBold : 0
      const letterMode =
        (wp.entrance.letterwise && time < word.onset + wp.entrance.duration) ||
        wp.hold.letterwise ||
        wp.letterSpread !== 1
      const deform = wp.entrance.deform ? wp.entrance.deform(time - word.onset) : null
      if (letterMode && word.letters) {
        for (const letter of word.letters) {
          if (time < word.onset + letter.delay) continue
          this.drawGlyph(letter.char, letter.body, word.fontSize, parts.voice, fill, alpha, {
            pivot: false,
            deform: null,
            squash: 0,
            bold,
            echo: wp.echo,
          })
        }
      } else {
        this.drawGlyph(word.text, word.body, word.fontSize, parts.voice, fill, alpha, {
          pivot: wp.holdName === 'pendulum',
          deform,
          squash: word.squash,
          ghostFrom: { x: word.prevX, y: word.prevY },
          bold,
          echo: wp.echo,
        })
      }
    })
  }

  private drawOutgoing(time: number): void {
    const out = this.outgoing
    if (!out) return
    const elapsed = time - out.start
    for (const { word, motion } of out.words) {
      const alpha = out.snap
        ? 1
        : Math.max(0, 1 - Math.max(0, elapsed - motion.delay) / TEXT.exitSec)
      if (alpha <= 0) continue
      this.drawGlyph(word.text, word.body, word.fontSize, out.parts.voice, out.parts.fill, alpha, {
        pivot: out.parts.hold === 'pendulum',
        deform: null,
        squash: 0,
      })
    }
  }

  private drawShatter(time: number): void {
    const S = EXIT_T.shatter
    for (const l of this.shatter) {
      const alpha = Math.min(1, Math.max(0, 1 - (time - l.start) / S.fadeSec))
      const body = { x: l.x, y: l.y, vx: l.vx, vy: l.vy, rot: l.rot, vrot: l.vrot, scale: 1, vscale: 0 }
      this.drawGlyph(l.char, body, l.fontSize, l.voice, l.fill, alpha, {
        pivot: false,
        deform: null,
        squash: 0,
      })
    }
  }

  private drawGlyph(
    text: string,
    b: Body,
    fontSize: number,
    voiceName: VoiceName,
    fill: Rgb,
    alpha: number,
    opts: {
      pivot: boolean
      deform: number | null
      squash: number
      ghostFrom?: { x: number; y: number }
      bold?: number
      echo?: number
    },
  ): void {
    if (!this.fontsReady) {
      fontGate.violations++
      return
    }
    const { ctx } = this
    const { w, h } = this.view
    const speed = Math.hypot(b.vx, b.vy)
    // The measured width excludes the trailing letter-space; shift the
    // drawn box by half of it so the ink itself is centered.
    const inkShift = (VOICES[voiceName].tracking * fontSize) / 2

    // Optional ghost trails at high speed (off by default).
    if (TEXT.ghostTrails > 0 && speed > TEXT.ghostMinSpeed && opts.ghostFrom) {
      const gx = opts.ghostFrom.x
      const gy = opts.ghostFrom.y
      for (const [t, a] of [
        [0.5, 0.3],
        [1, 0.15],
      ]) {
        ctx.save()
        ctx.translate((b.x + (gx - b.x) * t) * w, (b.y + (gy - b.y) * t) * h)
        ctx.rotate(b.rot)
        ctx.scale(b.scale, b.scale)
        this.setFont(voiceName, fontSize)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = rgba(fill, alpha * a * TEXT.ghostTrails)
        ctx.fillText(text, inkShift, 0)
        ctx.restore()
      }
    }

    // Echo gesture: expanding rings behind the word.
    if (opts.echo && opts.echo > 0) {
      for (const [grow, a] of [
        [1.18, 0.28],
        [1.4, 0.12],
      ]) {
        ctx.save()
        ctx.translate(b.x * w, b.y * h)
        ctx.rotate(b.rot)
        ctx.scale(b.scale * grow, b.scale * grow)
        this.setFont(voiceName, fontSize)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = rgba(fill, alpha * a * opts.echo)
        ctx.fillText(text, inkShift, 0)
        ctx.restore()
      }
    }

    ctx.save()
    ctx.translate(b.x * w, b.y * h)
    // Stretch along velocity, area preserved.
    const stretch = Math.min(TEXT.stretchMax, speed * TEXT.squashStretch * 0.35)
    if (stretch > 0.02) {
      const angle = Math.atan2(b.vy * h, b.vx * w)
      ctx.rotate(angle)
      ctx.scale(1 + stretch, 1 / (1 + stretch))
      ctx.rotate(-angle)
    }
    // Squash on impact: wider and shorter, area preserved.
    if (opts.squash > 0.02) {
      ctx.scale(1 + opts.squash, 1 / (1 + opts.squash))
    }
    if (opts.pivot) {
      const pivot = fontSize * 0.9
      ctx.translate(0, -pivot)
      ctx.rotate(b.rot)
      ctx.translate(0, pivot)
    } else {
      ctx.rotate(b.rot)
    }
    ctx.scale(b.scale, b.scale)
    if (opts.deform !== null && opts.deform < 1) {
      // Hinge on the baseline: opens from flat to upright.
      ctx.translate(0, fontSize / 2)
      ctx.scale(1, Math.max(0.02, opts.deform))
      ctx.translate(0, -fontSize / 2)
    }
    this.setFont(voiceName, fontSize)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = rgba(fill, alpha)
    // Focus words are set heavier: a same-color stroke fattens the face.
    if (opts.bold && opts.bold > 0) {
      ctx.strokeStyle = rgba(fill, alpha)
      ctx.lineWidth = opts.bold * fontSize
      ctx.lineJoin = 'round'
      ctx.strokeText(text, inkShift, 0)
    }
    ctx.fillText(text, inkShift, 0)
    ctx.restore()
  }

  private setFont(voiceName: VoiceName, sizePx: number): void {
    const voice = VOICES[voiceName]
    this.ctx.font = fontString(voice, sizePx)
    this.ctx.letterSpacing = `${(voice.tracking * sizePx).toFixed(2)}px`
  }

  // --- introspection ---------------------------------------------------------

  inspect(): { lineCount: number; words: WordState[] } {
    const { w, h } = this.view
    return {
      lineCount:
        (this.words.some((word) => word.entered && word.exitedAt === null) ? 1 : 0) +
        (this.outgoing ? 1 : 0) +
        (this.shatter.length > 0 ? 1 : 0),
      words: this.words.map((word) => {
        let letterMaxOffsetPx = 0
        let letterMaxTiltDeg = 0
        if (word.letters) {
          for (const letter of word.letters) {
            letterMaxOffsetPx = Math.max(
              letterMaxOffsetPx,
              Math.hypot(
                (letter.body.x - letter.home.x) * w,
                (letter.body.y - letter.home.y) * h,
              ),
            )
            letterMaxTiltDeg = Math.max(
              letterMaxTiltDeg,
              Math.abs((letter.body.rot * 180) / Math.PI),
            )
          }
        }
        return {
          entered: word.entered,
          exiting: word.exitedAt !== null,
          onset: word.onset,
          rotDeg: (word.body.rot * 180) / Math.PI,
          xPx: word.body.x * w,
          yPx: word.body.y * h,
          slotXPx: word.slotX * w,
          slotYPx: word.slotY * h,
          wPx: word.wPx,
          hPx: word.fontSize,
          fontSize: word.fontSize,
          letterMaxOffsetPx,
          letterMaxTiltDeg,
        }
      }),
    }
  }
}
