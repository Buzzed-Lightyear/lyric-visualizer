import { useEffect, useRef, useState } from 'react'
import { AudioAnalysis } from './analysis'
import { activeLineIndex, parseLrc, type LyricLine } from './lrc'
import { Scene } from './scene'

// Steps 1-2 hardcode one song. Both files live in public/song/ (gitignored).
const AUDIO_SRC = '/song/song.mp3'
const LRC_SRC = '/song/song.lrc'

/**
 * Corrects constant lag between audio and lyrics, in seconds.
 * Positive shows each line earlier; negative shows it later.
 */
const LYRIC_OFFSET_SECONDS = 0

function App() {
  const [audioFailed, setAudioFailed] = useState(false)
  const [lines, setLines] = useState<LyricLine[] | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [showLyrics, setShowLyrics] = useState(true)
  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The loop reads these refs so it never restarts, and canvas concerns
  // (the debug overlay) never pass through React state.
  const linesRef = useRef<LyricLine[]>([])
  const debugRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    fetch(LRC_SRC)
      .then((response) => (response.ok ? response.text() : ''))
      .then((text) => {
        if (cancelled) return
        const parsed = parseLrc(text)
        linesRef.current = parsed
        setLines(parsed)
      })
      .catch(() => {
        if (!cancelled) setLines([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'l') setShowLyrics((visible) => !visible)
      if (key === 'd') debugRef.current = !debugRef.current
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // One loop per frame: sample the audio, draw the scene, pick the lyric
  // line. The line is derived from currentTime so pause and seek just work.
  useEffect(() => {
    const audio = audioRef.current
    const canvas = canvasRef.current
    if (!audio || !canvas) return

    const analysis = new AudioAnalysis(audio)
    const scene = new Scene(canvas)
    const onResize = () => scene.resize()
    onResize()
    window.addEventListener('resize', onResize)

    let last = performance.now()
    let frameId = requestAnimationFrame(function tick(now) {
      // Clamp dt so a backgrounded tab doesn't come back with a huge step.
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      const frame = analysis.sample(dt)
      scene.draw(frame, dt)
      if (debugRef.current) scene.drawDebug(frame)
      setActiveIndex(
        activeLineIndex(linesRef.current, audio.currentTime + LYRIC_OFFSET_SECONDS),
      )
      frameId = requestAnimationFrame(tick)
    })

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', onResize)
      analysis.dispose()
    }
  }, [])

  const activeLine = lines && activeIndex >= 0 ? lines[activeIndex] : null

  return (
    <>
      <canvas ref={canvasRef} className="scene" aria-hidden="true" />
      <main>
        <h1>Lyric Visualizer</h1>
        <audio
          ref={audioRef}
          controls
          src={AUDIO_SRC}
          onError={() => setAudioFailed(true)}
          onLoadedMetadata={() => setAudioFailed(false)}
        />
        {audioFailed && (
          <p role="alert">
            Couldn't load <code>{AUDIO_SRC}</code>. Put your audio file at{' '}
            <code>public{AUDIO_SRC}</code> and reload.
          </p>
        )}
        {lines !== null && lines.length === 0 && (
          <p role="alert">
            No timed lines found in <code>{LRC_SRC}</code>. Put your lyrics
            file at <code>public{LRC_SRC}</code> and reload.
          </p>
        )}
        <p
          className="lyric-line"
          style={{ visibility: showLyrics ? 'visible' : 'hidden' }}
        >
          {activeLine?.text ?? ' '}
        </p>
        <p className="hint">L lyrics · D debug</p>
      </main>
    </>
  )
}

export default App
