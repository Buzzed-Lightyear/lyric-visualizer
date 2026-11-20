/**
 * The scripted test track every preset is judged on, and the four
 * moments its strip shows: QUIET, LOUD, ON A BEAT, LATER. Shared by the
 * catalog capture (src/catalogRunner.ts) and the readability check
 * (src/legibilityProbe.ts), so both look at a preset under exactly the
 * same conditions. Offline and deterministic: butterchurn's render()
 * takes injected audio levels and a fixed clock.
 */

import butterchurnModule from 'butterchurn'
import { unwrapButterchurn } from './background'
import { loadAllPresets } from './presetPacks'

const butterchurn = unwrapButterchurn(butterchurnModule)

export const STRIP_W = 320
export const STRIP_H = 180
export const STRIP_FPS = 30
export const STRIP_DT = 1 / STRIP_FPS
const SR = 44100

/** Capture times (s) of the four strip frames, and what each one is. */
export const STRIP_TIMES = [3.1, 4.8, 6.07, 8.5] as const
export const STRIP_CONDITIONS = ['quiet', 'loud', 'beat', 'later'] as const
/** The track's length (s). */
export const STRIP_END = 8.6

/**
 * The scripted test track: warm-up (loud) to 2 s, QUIET 2..3.2 s, LOUD
 * 3.2..5.4 s, steady BEATS at 5.5/6.0/6.5/7.0 s, loud tail to 8.6 s.
 */
function trackAmp(t: number): number {
  return t >= 2 && t < 3.2 ? 0.12 : 0.9
}

function beatEnv(t: number): number {
  if (t < 5.4 || t >= 7.4) return 0
  const phase = (t - 5.5 + 10) % 0.5
  return Math.exp(-phase * 10)
}

export function audioLevels(t: number): {
  timeByteArray: Uint8Array
  timeByteArrayL: Uint8Array
  timeByteArrayR: Uint8Array
} {
  const N = 1024
  const timeByteArray = new Uint8Array(N)
  const timeByteArrayL = new Uint8Array(N)
  const timeByteArrayR = new Uint8Array(N)
  const amp = trackAmp(t)
  const kick = beatEnv(t)
  for (let i = 0; i < N; i++) {
    const ts = t + i / SR
    const bass = Math.sin(2 * Math.PI * 55 * ts) * (0.55 + kick * 1.4)
    const mid = Math.sin(2 * Math.PI * 440 * ts + Math.sin(ts * 3) * 2) * 0.32
    const high =
      (Math.sin(2 * Math.PI * 3203 * ts) + Math.sin(2 * Math.PI * 5277 * ts)) * 0.11
    const clamp = (v: number) => Math.max(-1, Math.min(1, v))
    timeByteArray[i] = Math.round(128 + clamp((bass + mid + high) * amp) * 100)
    timeByteArrayL[i] = Math.round(128 + clamp((bass + mid * 1.2) * amp) * 100)
    timeByteArrayR[i] = Math.round(128 + clamp((bass * 0.8 + mid + high * 1.5) * amp) * 100)
  }
  return { timeByteArray, timeByteArrayL, timeByteArrayR }
}

/**
 * Render one preset through the track and return its four strip frames
 * (quiet, loud, beat, later), or null when the preset is missing or
 * WebGL 2 is unavailable.
 */
export async function renderStripFrames(name: string): Promise<HTMLCanvasElement[] | null> {
  const presets = await loadAllPresets()
  const preset = presets[name]
  if (!preset) return null
  const canvas = document.createElement('canvas')
  canvas.width = STRIP_W
  canvas.height = STRIP_H
  if (!canvas.getContext('webgl2')) return null
  const context = new AudioContext()
  try {
    const visualizer = butterchurn.createVisualizer(context, canvas, {
      width: STRIP_W,
      height: STRIP_H,
    })
    visualizer.loadPreset(preset, 0)
    const frames: HTMLCanvasElement[] = []
    const total = Math.round(STRIP_END * STRIP_FPS)
    for (let i = 0; i < total && frames.length < STRIP_TIMES.length; i++) {
      const t = i * STRIP_DT
      visualizer.render({ elapsedTime: STRIP_DT, audioLevels: audioLevels(t) })
      if (t >= STRIP_TIMES[frames.length]) {
        const copy = document.createElement('canvas')
        copy.width = STRIP_W
        copy.height = STRIP_H
        copy.getContext('2d')!.drawImage(canvas, 0, 0)
        frames.push(copy)
      }
    }
    return frames.length === STRIP_TIMES.length ? frames : null
  } catch {
    return null
  } finally {
    await context.close()
  }
}
