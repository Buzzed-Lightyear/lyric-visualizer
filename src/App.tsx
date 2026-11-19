import { useEffect, useRef, useState } from 'react'
import { AudioAnalysis } from './analysis'
import { Background } from './background'
import { BEHAVIOR_NAMES, type BehaviorName } from './behaviors'
import { SectionCommitter } from './committer'
import { drawDebug } from './debug'
import { createKnobs, type Knobs } from './knobs'
import { activeLineIndex, parseLrc, type LyricLine } from './lrc'
import { chooseMotif, paramsForSection, textParamsForSection } from './mapping'
import { pinPreset } from './presetMap'
import { createRandom } from './random'
import { Scene } from './scene'
import {
  activeSectionIndex,
  DEFAULT_EMPHASIS,
  emphasisAt,
  parseSemantics,
  type Semantics,
  type SemanticSection,
} from './semantics'
import { TextLayer } from './textLayer'

// The spike hardcodes one song. The files live in public/song/; only the
// semantics fixture is committed.
const AUDIO_SRC = '/song/song.mp3'
const LRC_SRC = '/song/song.lrc'
const SEMANTICS_SRC = '/song/song.semantics.json'

/**
 * Corrects constant lag between audio and lyrics, in seconds.
 * Positive shows each line earlier; negative shows it later.
 */
const LYRIC_OFFSET_SECONDS = 0

interface Committed {
  key: string
  energy: number
  section: SemanticSection | null
}

function App() {
  const [audioFailed, setAudioFailed] = useState(false)
  const [lines, setLines] = useState<LyricLine[] | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [showLyrics, setShowLyrics] = useState(true)
  const [physicsText, setPhysicsText] = useState(true)
  const [semanticsErrors, setSemanticsErrors] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const bgCanvasRef = useRef<HTMLCanvasElement>(null)
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null)
  const textCanvasRef = useRef<HTMLCanvasElement>(null)
  // The loop reads these refs so it never restarts, and canvas concerns
  // never pass through React state.
  const linesRef = useRef<LyricLine[]>([])
  const semanticsRef = useRef<Semantics | null>(null)
  const semanticsOnRef = useRef(true)
  const debugRef = useRef(false)
  const showLyricsRef = useRef(true)
  const physicsTextRef = useRef(true)
  const behaviorOverrideRef = useRef<BehaviorName | null>(null)
  const backgroundRef = useRef<Background | null>(null)
  const committedRef = useRef<Committed>({ key: 'neutral', energy: 0.5, section: null })
  const knobsRef = useRef<Knobs | null>(null)

  useEffect(() => {
    const knobs = createKnobs()
    knobsRef.current = knobs
    // Canvas ctx.font never triggers CSS font loading; request the faces
    // up front so the first laid-out line measures with the real fonts.
    void document.fonts.load('400 32px "Archivo Black"')
    void document.fonts.load('300 32px Inter')
    return () => {
      knobsRef.current = null
      knobs.dispose()
    }
  }, [])

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
          console.error(`${SEMANTICS_SRC} has ${errors.length} problem(s); running neutral:`)
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
      if (key === 'l') {
        setShowLyrics((visible) => {
          showLyricsRef.current = !visible
          return !visible
        })
      }
      if (key === 'd') debugRef.current = !debugRef.current
      if (key === 's') semanticsOnRef.current = !semanticsOnRef.current
      if (key === 'k') knobsRef.current?.toggle()
      if (key === 't') {
        setPhysicsText((on) => {
          physicsTextRef.current = !on
          return !on
        })
      }
      if (key === 'b') backgroundRef.current?.cycleMode()
      if (key === '[') backgroundRef.current?.cyclePreset(-1)
      if (key === ']') backgroundRef.current?.cyclePreset(1)
      if (key === 'm') {
        const background = backgroundRef.current
        const mood = committedRef.current.section?.mood ?? 'neutral'
        if (background && background.currentPreset !== '(none)') {
          pinPreset(mood, background.currentPreset)
        }
      }
      if (key >= '1' && key <= '5') {
        behaviorOverrideRef.current = BEHAVIOR_NAMES[Number(key) - 1]
      }
      if (key === '0') behaviorOverrideRef.current = null
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // One loop per frame: sample the audio, commit section changes on the
  // beat, render the background, the text physics, and the debug overlay.
  // Everything derives from currentTime, so pause and seek just work.
  useEffect(() => {
    const audio = audioRef.current
    const bgCanvas = bgCanvasRef.current
    const sceneCanvas = sceneCanvasRef.current
    const textCanvas = textCanvasRef.current
    if (!audio || !bgCanvas || !sceneCanvas || !textCanvas) return

    const analysis = new AudioAnalysis(audio)
    const scene = new Scene(sceneCanvas, createRandom(1337))
    const text = new TextLayer(textCanvas, createRandom(4242))
    const background = new Background(bgCanvas, audio)
    backgroundRef.current = background
    const committer = new SectionCommitter<Committed>(committedRef.current)
    const onResize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      const dpr = window.devicePixelRatio || 1
      scene.resize(w, h, dpr)
      text.resize(w, h, dpr)
      background.resize(w, h)
    }
    const onSeeking = () => {
      scene.notifySeek()
      committer.notifySeek()
    }
    onResize()
    window.addEventListener('resize', onResize)
    audio.addEventListener('seeking', onSeeking)

    let last = performance.now()
    let frameId = requestAnimationFrame(function tick(now) {
      // Clamp dt so a backgrounded tab doesn't come back with a huge step.
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now

      const frame = analysis.sample(dt)
      const t = audio.currentTime + LYRIC_OFFSET_SECONDS
      const lineIndex = activeLineIndex(linesRef.current, t)

      const semantics = semanticsOnRef.current ? semanticsRef.current : null
      let section: SemanticSection | null = null
      let emphasis = DEFAULT_EMPHASIS
      if (semantics) {
        const sectionIndex = activeSectionIndex(semantics.sections, audio.currentTime)
        section = sectionIndex >= 0 ? semantics.sections[sectionIndex] : null
        emphasis = emphasisAt(
          semantics,
          lineIndex >= 0 ? linesRef.current[lineIndex].time : null,
        )
      }

      // Preset + text style switch on the committed section, on the beat.
      const commit = committer.update(
        {
          key: section ? `${section.label}@${section.start}` : 'neutral',
          energy: section?.energy ?? 0.5,
          section,
        },
        frame.beat,
        dt,
      )
      if (commit) {
        committedRef.current = commit.value
        background.applyMood(commit.value.section?.mood ?? 'neutral', commit.blendSec)
      }

      // Background layer.
      const mode = background.mode
      bgCanvas.style.visibility = mode === 'butterchurn' ? 'visible' : 'hidden'
      sceneCanvas.style.visibility = mode === 'scene' ? 'visible' : 'hidden'
      if (mode === 'butterchurn') background.render()
      else if (mode === 'scene') scene.draw(frame, paramsForSection(section, emphasis), dt)

      // Text layer (plus scrim/tint, which it always draws).
      const committedSection = committedRef.current.section
      const textParams = textParamsForSection(committedSection, emphasis)
      const lyrics = linesRef.current
      const line =
        physicsTextRef.current && showLyricsRef.current && lineIndex >= 0
          ? {
              index: lineIndex,
              text: lyrics[lineIndex].text,
              start: lyrics[lineIndex].time,
              end: lyrics[lineIndex + 1]?.time ?? lyrics[lineIndex].time + 4,
            }
          : null
      text.draw(
        frame,
        { params: textParams, line, time: t, behaviorOverride: behaviorOverrideRef.current },
        dt,
      )

      if (debugRef.current) {
        const { motif, tag } = chooseMotif(section?.imagery ?? [])
        drawDebug(text.context, frame, [
          `sem    ${!semanticsRef.current ? 'none loaded' : semanticsOnRef.current ? 'on' : 'off (neutral)'}`,
          `sect   ${section ? `${section.label} · ${section.mood} · energy ${section.energy.toFixed(2)}` : '(none)'}`,
          `commit ${committedRef.current.key}`,
          `motif  ${tag ? `${motif} <- ${tag}` : motif}  ·  emph ${emphasis.toFixed(2)}`,
          `bg     ${mode}  ·  ${background.currentPreset}`,
          `text   ${physicsTextRef.current ? 'physics' : 'dom line'}  ·  ${behaviorOverrideRef.current ?? `${textParams.behavior} (mood)`}`,
        ])
      }
      setActiveIndex(lineIndex)
      frameId = requestAnimationFrame(tick)
    })

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', onResize)
      audio.removeEventListener('seeking', onSeeking)
      backgroundRef.current = null
      analysis.dispose()
    }
  }, [])

  const activeLine = lines && activeIndex >= 0 ? lines[activeIndex] : null

  return (
    <>
      <canvas ref={bgCanvasRef} className="bg" aria-hidden="true" />
      <canvas ref={sceneCanvasRef} className="scene" aria-hidden="true" />
      <canvas ref={textCanvasRef} className="text" aria-hidden="true" />
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
        {!physicsText && (
          <p
            className="lyric-line"
            style={{ visibility: showLyrics ? 'visible' : 'hidden' }}
          >
            {activeLine?.text ?? ' '}
          </p>
        )}
        <p className="hint">
          L lyrics · T text mode · B background · [ ] preset · M pin · 1-5/0
          behavior · D debug · S semantics · K knobs
        </p>
      </main>
    </>
  )
}

export default App
