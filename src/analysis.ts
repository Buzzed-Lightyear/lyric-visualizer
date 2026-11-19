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

interface Graph {
  context: AudioContext
  analyser: AnalyserNode
}

// createMediaElementSource may be called only once per element, and React
// StrictMode runs effects twice in dev, so the graph is cached per element.
const graphs = new WeakMap<HTMLMediaElement, Graph>()

function getGraph(audio: HTMLMediaElement): Graph {
  let graph = graphs.get(audio)
  if (!graph) {
    const context = new AudioContext()
    const source = context.createMediaElementSource(audio)
    const analyser = context.createAnalyser()
    analyser.fftSize = ANALYSIS.fftSize
    analyser.smoothingTimeConstant = ANALYSIS.analyserSmoothing
    source.connect(analyser)
    // Playback is silent unless the rerouted source reaches the output.
    analyser.connect(context.destination)
    graph = { context, analyser }
    graphs.set(audio, graph)
  }
  return graph
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

/** Owns the analyser side of the seam; the renderer only ever sees AudioFrame. */
export class AudioAnalysis {
  private readonly bins = new Uint8Array(ANALYSIS.fftSize / 2)
  private readonly level = new Channel()
  private readonly bass = new Channel()
  private readonly mid = new Channel()
  private readonly high = new Channel()
  private readonly beat = new BeatDetector()
  private readonly onPlay: () => void
  private readonly audio: HTMLAudioElement

  constructor(audio: HTMLAudioElement) {
    this.audio = audio
    // An AudioContext can't start before a user gesture, so the graph is
    // created (or resumed) on the element's play event.
    this.onPlay = () => {
      const { context } = getGraph(this.audio)
      if (context.state !== 'running') void context.resume()
    }
    audio.addEventListener('play', this.onPlay)
    if (!audio.paused) this.onPlay()
  }

  dispose(): void {
    this.audio.removeEventListener('play', this.onPlay)
  }

  /** Reduce the current spectrum to one AudioFrame. Call once per frame. */
  sample(dt: number): AudioFrame {
    const graph = graphs.get(this.audio)
    let level = 0
    let bass = 0
    let mid = 0
    let high = 0
    // When paused there is no input; raw zeros let every value fall to 0.
    if (graph && !this.audio.paused && graph.context.state === 'running') {
      graph.analyser.getByteFrequencyData(this.bins)
      const hzPerBin = graph.context.sampleRate / ANALYSIS.fftSize
      const { bands } = ANALYSIS
      bass = bandAverage(this.bins, hzPerBin, bands.bass[0], bands.bass[1])
      mid = bandAverage(this.bins, hzPerBin, bands.mid[0], bands.mid[1])
      high = bandAverage(this.bins, hzPerBin, bands.high[0], bands.high[1])
      level = bandAverage(this.bins, hzPerBin, bands.bass[0], bands.high[1])
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
