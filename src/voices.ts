/**
 * Type voices: named faces with weight, case and tracking. All families
 * are OFL-licensed and bundled through Fontsource; importing this module
 * registers every face, and loadAllFonts() must resolve before anything
 * draws text, so nothing ever renders in a fallback font.
 */

import '@fontsource/archivo-black'
import '@fontsource/inter/300.css'
import '@fontsource/anton'
import '@fontsource/playfair-display/700.css'
import '@fontsource/cormorant-garamond/500-italic.css'
import '@fontsource/space-mono'
import '@fontsource/permanent-marker'
import '@fontsource/alfa-slab-one'

export type VoiceName =
  | 'block'
  | 'air'
  | 'condensed'
  | 'serif'
  | 'whisper'
  | 'mono'
  | 'marker'
  | 'slab'

export interface Voice {
  family: string
  weight: number
  italic: boolean
  caps: boolean
  /** Letter tracking in ems. */
  tracking: number
}

export const VOICES: Record<VoiceName, Voice> = {
  /** Heavy geometric display. */
  block: { family: '"Archivo Black"', weight: 400, italic: false, caps: true, tracking: 0.02 },
  /** Light, airy sans. */
  air: { family: 'Inter', weight: 300, italic: false, caps: false, tracking: 0.12 },
  /** Condensed caps display. */
  condensed: { family: 'Anton', weight: 400, italic: false, caps: true, tracking: 0.06 },
  /** High-contrast serif. */
  serif: { family: '"Playfair Display"', weight: 700, italic: false, caps: false, tracking: 0.02 },
  /** Delicate serif italic. */
  whisper: { family: '"Cormorant Garamond"', weight: 500, italic: true, caps: false, tracking: 0.1 },
  /** Typewriter mono. */
  mono: { family: '"Space Mono"', weight: 400, italic: false, caps: false, tracking: 0.04 },
  /** Marker / brush. */
  marker: { family: '"Permanent Marker"', weight: 400, italic: false, caps: false, tracking: 0.03 },
  /** Fat slab. */
  slab: { family: '"Alfa Slab One"', weight: 400, italic: false, caps: false, tracking: 0.03 },
}

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
