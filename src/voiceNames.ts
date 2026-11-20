/**
 * The eight type voices as pure data: names, faces, weight, case and
 * tracking. Kept apart from voices.ts (which imports the font files and
 * measures them on a canvas) so the semantics parser, the Node scripts
 * and the tests can use a voice without loading fonts.
 */

export const VOICE_NAME_LIST = [
  'block',
  'air',
  'condensed',
  'serif',
  'whisper',
  'mono',
  'marker',
  'slab',
] as const

export type VoiceName = (typeof VOICE_NAME_LIST)[number]

/** One plain line per voice: what the face is, never when to use it. */
export const VOICE_DESCRIPTIONS: Record<VoiceName, string> = {
  block: 'heavy geometric sans, all caps (Archivo Black)',
  air: 'light, widely tracked sans (Inter Light)',
  condensed: 'tall condensed caps (Anton)',
  serif: 'high-contrast bold serif (Playfair Display)',
  whisper: 'delicate serif italic (Cormorant Garamond)',
  mono: 'typewriter monospace (Space Mono)',
  marker: 'hand-drawn brush marker (Permanent Marker)',
  slab: 'fat rounded slab serif (Alfa Slab One)',
}

export interface Voice {
  family: string
  weight: number
  italic: boolean
  caps: boolean
  /** Letter tracking in ems. */
  tracking: number
  /** Word-space factor on the font's own space advance. */
  wordSpace: number
}

export const VOICES: Record<VoiceName, Voice> = {
  /** Heavy geometric display. */
  block: { family: '"Archivo Black"', weight: 400, italic: false, caps: true, tracking: 0.02, wordSpace: 1 },
  /** Light, airy sans. */
  air: { family: 'Inter', weight: 300, italic: false, caps: false, tracking: 0.12, wordSpace: 1.25 },
  /** Condensed caps display. */
  condensed: { family: 'Anton', weight: 400, italic: false, caps: true, tracking: 0.06, wordSpace: 1.15 },
  /** High-contrast serif. */
  serif: { family: '"Playfair Display"', weight: 700, italic: false, caps: false, tracking: 0.02, wordSpace: 1.15 },
  /** Delicate serif italic. */
  whisper: { family: '"Cormorant Garamond"', weight: 500, italic: true, caps: false, tracking: 0.1, wordSpace: 1.35 },
  /** Typewriter mono. */
  mono: { family: '"Space Mono"', weight: 400, italic: false, caps: false, tracking: 0.04, wordSpace: 1 },
  /** Marker / brush. */
  marker: { family: '"Permanent Marker"', weight: 400, italic: false, caps: false, tracking: 0.03, wordSpace: 1.05 },
  /** Fat slab. */
  slab: { family: '"Alfa Slab One"', weight: 400, italic: false, caps: false, tracking: 0.03, wordSpace: 1.05 },
}

export function isVoiceName(value: unknown): value is VoiceName {
  return typeof value === 'string' && (VOICE_NAME_LIST as readonly string[]).includes(value)
}
