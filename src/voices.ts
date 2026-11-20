/**
 * Type voices: named faces with weight, case and tracking. All families
 * are OFL-licensed and bundled through Fontsource; importing this module
 * registers every face, and loadAllFonts() must resolve before anything
 * draws text, so nothing ever renders in a fallback font.
 */

import type { TypeStyle } from './layout'
import { TYPESET } from './tuning'
import { VOICES, type Voice, type VoiceName } from './voiceNames'

import '@fontsource/archivo-black'
import '@fontsource/inter/300.css'
import '@fontsource/anton'
import '@fontsource/playfair-display/700.css'
import '@fontsource/cormorant-garamond/500-italic.css'
import '@fontsource/space-mono'
import '@fontsource/permanent-marker'
import '@fontsource/alfa-slab-one'

export type { VoiceName } from './voiceNames'

export { VOICES, type Voice } from './voiceNames'

export const VOICE_NAMES = Object.keys(VOICES) as VoiceName[]

export function fontString(voice: Voice, sizePx: number): string {
  return `${voice.italic ? 'italic ' : ''}${voice.weight} ${sizePx}px ${voice.family}, system-ui, sans-serif`
}

const FONT_FACES = Object.values(VOICES).map((voice) => fontString(voice, 32))

/** Request every face; resolve when all are usable. */
export function loadAllFonts(): Promise<void> {
  return Promise.all(FONT_FACES.map((face) => document.fonts.load(face))).then(() => undefined)
}

export function allFontsLoaded(): boolean {
  return FONT_FACES.every((face) => document.fonts.check(face))
}

// --- measured metrics --------------------------------------------------------

type SpacedCtx = CanvasRenderingContext2D & { letterSpacing: string }

/** Real font metrics, in ems of the nominal size. */
export interface VoiceMetrics {
  /** The font's own space advance. */
  spaceEm: number
  /** Cap height (ascent of "H"). */
  capEm: number
  ascentEm: number
  descentEm: number
}

const REF = 100
const metricsCache = new Map<VoiceName, VoiceMetrics>()

/** Measure (and cache) a voice's metrics. Needs the faces loaded. */
export function voiceMetrics(ctx: CanvasRenderingContext2D, name: VoiceName): VoiceMetrics {
  const cached = metricsCache.get(name)
  if (cached) return cached
  const spaced = ctx as SpacedCtx
  ctx.save()
  spaced.letterSpacing = '0px'
  ctx.font = fontString(VOICES[name], REF)
  const cap = ctx.measureText('H')
  const body = ctx.measureText('Hg')
  const metrics: VoiceMetrics = {
    spaceEm: ctx.measureText(' ').width / REF || 0.25,
    capEm: cap.actualBoundingBoxAscent / REF || 0.7,
    ascentEm: (body.fontBoundingBoxAscent ?? REF * 0.78) / REF,
    descentEm: (body.fontBoundingBoxDescent ?? REF * 0.22) / REF,
  }
  ctx.restore()
  // Metrics measured against a fallback face would poison the cache.
  if (allFontsLoaded()) metricsCache.set(name, metrics)
  return metrics
}

/** The TypeStyle the layouts need, derived from the measured metrics. */
export function typeStyleFor(
  ctx: CanvasRenderingContext2D,
  name: VoiceName,
): TypeStyle {
  const voice = VOICES[name]
  const m = voiceMetrics(ctx, name)
  return {
    wordSpaceFrac: m.spaceEm * voice.wordSpace + voice.tracking,
    leadingFrac:
      (m.ascentEm + m.descentEm) * (voice.caps ? TYPESET.leadingCaps : TYPESET.leading),
    sizeAdjust: TYPESET.capTarget / m.capEm,
  }
}

/**
 * A measure function for the layouts: sets the voice's font and tracking,
 * and excludes the trailing letter-space from the width so gaps and
 * centering are optically even.
 */
export function makeMeasure(
  ctx: CanvasRenderingContext2D,
  name: VoiceName,
): (text: string, fontSize: number) => number {
  const voice = VOICES[name]
  const spaced = ctx as SpacedCtx
  return (text, fontSize) => {
    if (text.length === 0) return 0
    ctx.font = fontString(voice, fontSize)
    spaced.letterSpacing = `${(voice.tracking * fontSize).toFixed(2)}px`
    return Math.max(0, ctx.measureText(text).width - voice.tracking * fontSize)
  }
}
