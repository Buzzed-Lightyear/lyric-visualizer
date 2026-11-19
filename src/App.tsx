import { useEffect, useRef, useState } from 'react'
import { AudioAnalysis } from './analysis'
import { activeLineIndex, parseLrc, type LyricLine } from './lrc'
import { chooseMotif, NEUTRAL_PARAMS, paramsForSection } from './mapping'
import { createRandom } from './random'
import { Scene } from './scene'
import {
  activeSectionIndex,
  DEFAULT_EMPHASIS,
  emphasisAt,
  parseSemantics,
  type Semantics,
} from './semantics'

// Steps 1-3 hardcode one song. The files live in public/song/; only the
// semantics fixture is committed.
const AUDIO_SRC = '/song/song.mp3'
const LRC_SRC = '/song/song.lrc'
const SEMANTICS_SRC = '/song/song.semantics.json'

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
  const [semanticsErrors, setSemanticsErrors] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The loop reads these refs so it never restarts, and canvas concerns
  // never pass through React state.
  const linesRef = useRef<LyricLine[]>([])
  const semanticsRef = useRef<Semantics | null>(null)
  const semanticsOnRef = useRef(true)
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
    let cancelled = false
    fetch(SEMANTICS_SRC)
      .then(async (response) => {
        if (!response.ok || cancelled) return // no file: neutral look
        let json: unknown
        try {
          json = await response.json()
        } catch {
          console.error(`${SEMANTICS_SRC} is not valid JSON; running neutral`)
          if (!cancelled) setSemanticsErrors(1)
          return
        }
        const { semantics, errors } = parseSemantics(json)
        if (errors.length > 0) {
          console.error(
            `${SEMANTICS_SRC} has ${errors.length} problem(s); running neutral:`,
          )
          for (const error of errors) console.error(`  - ${error}`)
        }
        if (cancelled) return
        semanticsRef.current = semantics
        setSemanticsErrors(errors.length)
      })
      .catch(() => {})
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
      if (key === 's') semanticsOnRef.current = !semanticsOnRef.current
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // One loop per frame: sample the audio, map semantics to params, draw
  // the scene, pick the lyric line. Everything derives from currentTime,
  // so pause and seek just work.
  useEffect(() => {
    const audio = audioRef.current
    const canvas = canvasRef.current
    if (!audio || !canvas) return

    const analysis = new AudioAnalysis(audio)
    const scene = new Scene(canvas, createRandom(1337))
    const onResize = () =>
      scene.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1)
    const onSeeking = () => scene.notifySeek()
    onResize()
    window.addEventListener('resize', onResize)
    audio.addEventListener('seeking', onSeeking)

    let last = performance.now()
    let frameId = requestAnimationFrame(function tick(now) {
      // Clamp dt so a backgrounded tab doesn't come back with a huge step.
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now

      const frame = analysis.sample(dt)
      const lineIndex = activeLineIndex(
        linesRef.current,
        audio.currentTime + LYRIC_OFFSET_SECONDS,
      )

      const semantics = semanticsOnRef.current ? semanticsRef.current : null
      let section = null
      let emphasis = DEFAULT_EMPHASIS
      if (semantics) {
        const sectionIndex = activeSectionIndex(semantics.sections, audio.currentTime)
        section = sectionIndex >= 0 ? semantics.sections[sectionIndex] : null
        emphasis = emphasisAt(
          semantics,
          lineIndex >= 0 ? linesRef.current[lineIndex].time : null,
        )
      }
      scene.draw(frame, paramsForSection(section, emphasis), dt)
      if (debugRef.current) {
        const { motif, tag } = chooseMotif(section?.imagery ?? [])
        scene.drawDebug(frame, {
          semantics: !semanticsRef.current
            ? 'none loaded'
            : semanticsOnRef.current
              ? 'on'
              : 'off (step 2 look)',
          section: !semantics
            ? '—'
            : section
              ? `${section.label} · ${section.mood} · energy ${section.energy.toFixed(2)}`
              : '(between sections)',
          motif: !semantics ? NEUTRAL_PARAMS.motif : tag ? `${motif} <- ${tag}` : motif,
          emphasis,
        })
      }
      setActiveIndex(lineIndex)
      frameId = requestAnimationFrame(tick)
    })

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', onResize)
      audio.removeEventListener('seeking', onSeeking)
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
        {semanticsErrors > 0 && (
          <p role="alert">
            <code>{SEMANTICS_SRC}</code> has {semanticsErrors} problem
            {semanticsErrors === 1 ? '' : 's'} (details in the console).
            Running the neutral look.
          </p>
        )}
        <p
          className="lyric-line"
          style={{ visibility: showLyrics ? 'visible' : 'hidden' }}
        >
          {activeLine?.text ?? ' '}
        </p>
        <p className="hint">L lyrics · D debug · S semantics</p>
      </main>
    </>
  )
}

export default App
