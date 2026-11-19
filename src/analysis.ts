/**
 * The Web Audio side: owns the graph on the <audio> element and reads the
 * spectrum each frame. All math lives in src/audioMath.ts.
 */

import { SpectrumReducer, ZERO_FRAME, type AudioFrame } from './audioMath'
import { ANALYSIS } from './tuning'

interface Graph {
  context: AudioContext
  analyser: AnalyserNode
  source: MediaElementAudioSourceNode
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
    graph = { context, analyser, source }
    graphs.set(audio, graph)
  }
  return graph
}

/**
 * The element's audio graph, if it exists yet (it is created on the first
 * play gesture). Butterchurn taps the source node through this.
 */
export function getAudioGraph(
  audio: HTMLMediaElement,
): { context: AudioContext; source: MediaElementAudioSourceNode } | null {
  const graph = graphs.get(audio)
  return graph ? { context: graph.context, source: graph.source } : null
}

export class AudioAnalysis {
  private readonly bins = new Uint8Array(ANALYSIS.fftSize / 2)
  private readonly onPlay: () => void
  private readonly audio: HTMLAudioElement
  private reducer: SpectrumReducer | null = null

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
    if (!graph) return ZERO_FRAME
    this.reducer ??= new SpectrumReducer(graph.context.sampleRate)
    const playing = !this.audio.paused && graph.context.state === 'running'
    // When paused there is no input; null lets every value fall to 0.
    if (playing) graph.analyser.getByteFrequencyData(this.bins)
    return this.reducer.update(playing ? this.bins : null, dt)
  }
}
