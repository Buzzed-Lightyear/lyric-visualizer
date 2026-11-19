/**
 * Mood -> butterchurn preset, in one place. The names below are first
 * guesses from reading preset titles, not auditioned choices: use [ and ]
 * to cycle presets and M to pin the current one to the current mood.
 * Pins live in localStorage and win over the guesses; M also logs a line
 * to paste into MOOD_PRESET below to make a pin permanent.
 */

import butterchurnPresets from 'butterchurn-presets'

export const PRESETS: Record<string, object> = butterchurnPresets.getPresets()
export const PRESET_NAMES: string[] = Object.keys(PRESETS).sort()

const MOOD_PRESET: Record<string, string> = {
  calm: 'cope + martin - mother-of-pearl',
  mournful: 'martin - angel flight',
  suspended: 'Flexi + Martin - astral projection',
  tense: 'Martin - acid wiring',
  menacing: '_Rovastar + Geiss - Hurricane Nightmare (Posterize Mix)',
  furious: 'Cope - The Neverending Explosion of Red Liquid Fire',
  weary: 'martin - ghost city',
  grieving: 'martin - stormy sea (2010 update)',
  brooding: 'Unchained & Rovastar - Wormhole Pillars (Hall of Shadows mix)',
  hollow: 'martin - glass corridor',
  neutral: 'Geiss - Spiral Artifact',
}

function hashString(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  return hash
}

/** Pure resolver so tests can inject names and pins. */
export function resolvePresetName(
  mood: string,
  names: readonly string[],
  pins: Record<string, string>,
  guesses: Record<string, string> = MOOD_PRESET,
): string {
  const key = mood.toLowerCase()
  const pinned = pins[key]
  if (pinned && names.includes(pinned)) return pinned
  const guess = guesses[key]
  if (guess && names.includes(guess)) return guess
  return names[hashString(key) % names.length]
}

const PIN_KEY = 'lyric-visualizer.presetPins'

export function loadPins(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PIN_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>
    }
  } catch {
    // localStorage unavailable or corrupt: fall through
  }
  return {}
}

export function pinPreset(mood: string, presetName: string): void {
  const key = mood.toLowerCase()
  const pins = loadPins()
  pins[key] = presetName
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(pins))
  } catch {
    // localStorage unavailable: the console line below still helps
  }
  console.log(`presetMap pin -> ${key}: ${JSON.stringify(presetName)},`)
}

export function presetNameForMood(mood: string): string {
  return resolvePresetName(mood, PRESET_NAMES, loadPins())
}
