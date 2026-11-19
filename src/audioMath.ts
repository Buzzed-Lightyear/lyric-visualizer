/**
 * The spectrum -> AudioFrame math, on plain arrays so it is testable
 * without a Web Audio graph. src/analysis.ts owns the graph and feeds
 * this; the harness and tests feed it synthetic spectra.
 */

import { ANALYSIS, BEAT } from './tuning'

/** What the renderer sees. Every value is 0..1. */
export interface AudioFrame {
  /** Overall loudness. */
  level: number
  bass: number
  mid: number
  high: number
  /** Jumps to 1 on a bass onset, then decays. */
  beat: number
}

/** Mean of the byte spectrum between two frequencies, scaled to 0..1. */
function bandAverage(
  bins: Uint8Array,
  hzPerBin: number,
  lowHz: number,
  highHz: number,
): number {
  const low = Math.max(0, Math.floor(lowHz / hzPerBin))
  const high = Math.min(bins.length - 1, Math.ceil(highHz / hzPerBin))
  let sum = 0
  for (let i = low; i <= high; i++) sum += bins[i]
  return sum / ((high - low + 1) * 255)
}

/**
 * One output channel: normalized against its own recent peak so quiet and
 * loud masters both use the full range, then smoothed with a fast attack
 * and a slower release so it doesn't flicker.
 */
class Channel {
  private peak: number = ANALYSIS.peakFloor
  private value = 0

  update(raw: number, dt: number): number {
    this.peak = Math.max(
      raw,
      ANALYSIS.peakFloor,
      this.peak * Math.exp(-ANALYSIS.peakDecay * dt),
    )
    const target = Math.min(1, raw / this.peak)
    const rate = target > this.value ? ANALYSIS.attack : ANALYSIS.release
    this.value += (target - this.value) * (1 - Math.exp(-rate * dt))
    return this.value
  }
}

/**
 * Fires when raw bass rises well above its recent running average, with a
 * refractory gap so one kick can't double-trigger. The threshold is
 * relative, so it needs no normalization of its own.
 */
class BeatDetector {
  private average = 0
  private sinceLast: number = BEAT.refractorySec
  private pulse = 0

  update(bass: number, dt: number): number {
    this.sinceLast += dt
    const onset = bass > BEAT.minBass && bass > this.average * BEAT.threshold
    if (onset && this.sinceLast >= BEAT.refractorySec) {
      this.pulse = 1
      this.sinceLast = 0
    } else {
      this.pulse *= Math.exp(-BEAT.pulseDecay * dt)
    }
    this.average += (bass - this.average) * (1 - Math.exp(-dt / BEAT.averageSec))
    return this.pulse
  }
}

/** Reduces byte spectra to AudioFrames. Pure state machine over arrays. */
export class SpectrumReducer {
  private readonly hzPerBin: number
  private readonly level = new Channel()
  private readonly bass = new Channel()
  private readonly mid = new Channel()
  private readonly high = new Channel()
  private readonly beat = new BeatDetector()

  constructor(sampleRate: number, fftSize: number = ANALYSIS.fftSize) {
    this.hzPerBin = sampleRate / fftSize
  }

  /** `bins` is the byte frequency data; null means no input (paused). */
  update(bins: Uint8Array | null, dt: number): AudioFrame {
    let level = 0
    let bass = 0
    let mid = 0
    let high = 0
    if (bins) {
      const { bands } = ANALYSIS
      bass = bandAverage(bins, this.hzPerBin, bands.bass[0], bands.bass[1])
      mid = bandAverage(bins, this.hzPerBin, bands.mid[0], bands.mid[1])
      high = bandAverage(bins, this.hzPerBin, bands.high[0], bands.high[1])
      level = bandAverage(bins, this.hzPerBin, bands.bass[0], bands.high[1])
    }
    return {
      level: this.level.update(level, dt),
      bass: this.bass.update(bass, dt),
      mid: this.mid.update(mid, dt),
      high: this.high.update(high, dt),
      beat: this.beat.update(bass, dt),
    }
  }
}

export const ZERO_FRAME: AudioFrame = { level: 0, bass: 0, mid: 0, high: 0, beat: 0 }
