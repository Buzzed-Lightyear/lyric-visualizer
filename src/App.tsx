import { useEffect, useRef, useState } from 'react'
import { AudioAnalysis } from './analysis'
import { Background } from './background'
import { SectionCommitter } from './committer'
import { drawDebug } from './debug'
import { createKnobs, type Knobs } from './knobs'
import { LAYOUT_NAMES } from './layout'
import { buildChoreo, lineWords, type LineChoreo } from './choreo'
import { activeLineIndex, parseLrc, type LyricLine } from './lrc'
import {
  chooseMotif,
  paramsForSection,
  sectionGrammar,
  textParamsForLine,
  type LineMotion,
} from './mapping'
import {
  COMBO_NAMES,
  COMBOS,
  ENTRANCE_NAMES,
  EXIT_NAMES,
  HOLD_NAMES,
} from './parts'
import feedbackJson from './presetFeedback.json'
import {
  CATALOG,
  CATALOG_NAMES,
  isUsable,
  pickForSections,
  rankForSection,
  type Feedback,
  type LabelPick,
} from './presetPick'
import { createRandom } from './random'
import { Scene } from './scene'
import {
  activeSectionIndex,
  DEFAULT_EMPHASIS,
  emphasisAt,
  parseSemantics,
  validateFocusRanges,
  type Semantics,
  type SemanticSection,
} from './semantics'
import { TextLayer, type PartOverrides } from './textLayer'
import { BUTTERCHURN } from './tuning'
import { loadAllFonts, VOICE_NAMES } from './voices'

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
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null)
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
  const overridesRef = useRef<PartOverrides>({})
  const choreoRef = useRef<LineChoreo[]>([])
  const gesturesOnRef = useRef(true)
  const feedbackRef = useRef<Feedback>({
    chosen: { ...(feedbackJson as Feedback).chosen },
    banned: [...(feedbackJson as Feedback).banned],
  })
  const picksRef = useRef<Map<string, LabelPick>>(new Map())
  const candidateIndexRef = useRef<Map<string, number>>(new Map())
  const browseIndexRef = useRef(-1)
  const backgroundRef = useRef<Background | null>(null)
  const committedRef = useRef<Committed>({ key: 'neutral', energy: 0.5, section: null })
  const knobsRef = useRef<Knobs | null>(null)

  const showToast = (text: string) => setToast({ text, key: Date.now() })

  const saveFeedback = () => {
    fetch('/__presetFeedback', {
      method: 'POST',
      body: JSON.stringify(feedbackRef.current),
    })
      .then((response) => {
        if (!response.ok) throw new Error('rejected')
      })
      .catch(() => showToast('feedback not saved (dev server only)'))
  }

  const recomputePicks = () => {
    const semantics = semanticsRef.current
    const fb = feedbackRef.current
    const map = semantics
      ? pickForSections(semantics.sections, fb)
      : new Map<string, LabelPick>()
    const candidates = rankForSection(null, fb)
    const saved = fb.chosen['neutral']
    const chosen =
      saved && isUsable(saved, fb) ? saved : (candidates[0]?.name ?? null)
    const scored = candidates.find((c) => c.name === chosen)
    map.set('neutral', {
      label: 'neutral',
      candidates,
      chosen,
      fromFeedback: Boolean(saved && isUsable(saved, fb)),
      reasons: scored?.reasons ?? [],
      runnerUp: candidates.find((c) => c.name !== chosen)?.name ?? null,
    })
    picksRef.current = map
  }

  const loadForLabel = (label: string, blendSec: number) => {
    const pick = picksRef.current.get(label)
    if (pick?.chosen) backgroundRef.current?.loadByName(pick.chosen, blendSec)
  }

  // Grammar, focus, gestures and refrains per lyric line; rebuilt when
  // either the lyrics or the semantics arrive.
  const rebuildChoreo = () => {
    choreoRef.current = buildChoreo(linesRef.current, semanticsRef.current)
    const semantics = semanticsRef.current
    if (semantics && linesRef.current.length > 0) {
      const problems = validateFocusRanges(
        semantics,
        linesRef.current.map((line) => ({
          time: line.time,
          wordCount: lineWords(line.text).length,
        })),
      )
      for (const problem of problems) console.error(`semantics focus: ${problem}`)
    }
  }

  useEffect(() => {
    const knobs = createKnobs({
      resetPresetFeedback: () => {
        feedbackRef.current = { chosen: {}, banned: [] }
        recomputePicks()
        saveFeedback()
        showToast('preset feedback reset')
      },
    })
    knobsRef.current = knobs
    // The old M-key pins were pressed at random; they are noise. Gone.
    try {
      localStorage.removeItem('lyric-visualizer.presetPins')
    } catch {
      // localStorage unavailable
    }
    recomputePicks()
    // Canvas ctx.font never triggers CSS font loading; request every face
    // up front — the text layer refuses to draw until all are ready.
    void loadAllFonts()
    return () => {
      knobsRef.current = null
      knobs.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(id)
  }, [toast])

  useEffect(() => {
    let cancelled = false
    fetch(LRC_SRC)
      .then((response) => (response.ok ? response.text() : ''))
      .then((text) => {
        if (cancelled) return
        const parsed = parseLrc(text)
        linesRef.current = parsed
        rebuildChoreo()
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
        recomputePicks()
        rebuildChoreo()
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
      if (key === 'g') gesturesOnRef.current = !gesturesOnRef.current
      if (event.key === ']' || event.key === '[') {
        const label = committedRef.current.section?.label ?? 'neutral'
        const pick = picksRef.current.get(label)
        if (pick && pick.candidates.length > 0) {
          const n = pick.candidates.length
          const current =
            candidateIndexRef.current.get(label) ??
            Math.max(0, pick.candidates.findIndex((c) => c.name === pick.chosen))
          const next = (current + (event.key === ']' ? 1 : -1) + n) % n
          candidateIndexRef.current.set(label, next)
          const name = pick.candidates[next].name
          feedbackRef.current.chosen[label] = name
          recomputePicks()
          saveFeedback()
          backgroundRef.current?.loadByName(name, BUTTERCHURN.cycleBlend)
          showToast(`${label}: candidate ${next + 1} of ${n}, saved`)
        }
      }
      if (event.key === '}' || event.key === '{') {
        // Browse the whole catalog; nothing is saved.
        if (CATALOG_NAMES.length > 0) {
          if (browseIndexRef.current < 0) {
            browseIndexRef.current = Math.max(
              0,
              CATALOG_NAMES.indexOf(backgroundRef.current?.currentPreset ?? ''),
            )
          }
          browseIndexRef.current =
            (browseIndexRef.current + (event.key === '}' ? 1 : -1) + CATALOG_NAMES.length) %
            CATALOG_NAMES.length
          const name = CATALOG_NAMES[browseIndexRef.current]
          backgroundRef.current?.loadByName(name, BUTTERCHURN.cycleBlend)
          showToast(`browse ${browseIndexRef.current + 1}/${CATALOG_NAMES.length}: ${name}`)
        }
      }
      if (key === 'n') {
        const name = backgroundRef.current?.currentPreset
        if (name && name !== '(none)') {
          const fb = feedbackRef.current
          if (!fb.banned.includes(name)) fb.banned.push(name)
          for (const [label, chosen] of Object.entries(fb.chosen)) {
            if (chosen === name) delete fb.chosen[label]
          }
          const label = committedRef.current.section?.label ?? 'neutral'
          candidateIndexRef.current.delete(label)
          recomputePicks()
          saveFeedback()
          loadForLabel(label, BUTTERCHURN.cycleBlend)
          showToast(`banned ${name}`)
        }
      }
      const cycle = <T,>(list: readonly T[], current: T | null | undefined): T => {
        const index = current ? list.indexOf(current) : -1
        return list[(index + 1) % list.length]
      }
      const o = overridesRef.current
      if (key === 'e') o.entrance = cycle(ENTRANCE_NAMES, o.entrance)
      if (key === 'h') o.hold = cycle(HOLD_NAMES, o.hold)
      if (key === 'x') o.exit = cycle(EXIT_NAMES, o.exit)
      if (key === 'f') o.voice = cycle(VOICE_NAMES, o.voice)
      if (key === 'y') o.layout = cycle(LAYOUT_NAMES, o.layout)
      if (key >= '1' && key <= '5') {
        const combo = COMBOS[COMBO_NAMES[Number(key) - 1]]
        o.entrance = combo.entrance
        o.hold = combo.hold
        o.exit = combo.exit
      }
      if (key === '0') overridesRef.current = {}
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
        loadForLabel(commit.value.section?.label ?? 'neutral', commit.blendSec)
      }

      // Background layer.
      const mode = background.mode
      bgCanvas.style.visibility = mode === 'butterchurn' ? 'visible' : 'hidden'
      sceneCanvas.style.visibility = mode === 'scene' ? 'visible' : 'hidden'
      if (mode === 'butterchurn') background.render()
      else if (mode === 'scene') scene.draw(frame, paramsForSection(section, emphasis), dt)

      // Text layer (plus scrim/tint, which it always draws).
      const committedSection = committedRef.current.section
      const lyrics = linesRef.current
      // The base grammar follows the beat-committed section; a refrain
      // keeps its source line's grammar. G drops focus and gestures.
      const choreo = lineIndex >= 0 ? choreoRef.current[lineIndex] : undefined
      let motion: LineMotion = {}
      if (semantics && choreo) {
        motion = gesturesOnRef.current
          ? {
              grammar:
                choreo.refrainOf !== null
                  ? choreo.grammar
                  : sectionGrammar(committedSection),
              focus: choreo.focus,
              gestures: choreo.gestures,
            }
          : { grammar: sectionGrammar(committedSection) }
      }
      const textParams = textParamsForLine(committedSection, emphasis, motion)
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
        { params: textParams, line, time: t, overrides: overridesRef.current },
        dt,
      )

      if (debugRef.current) {
        const { motif, tag } = chooseMotif(section?.imagery ?? [])
        const o = overridesRef.current
        const eff = (over: string | null | undefined, mapped: string) =>
          over ? `${over} (forced)` : mapped
        const committedLabel = committedRef.current.section?.label ?? 'neutral'
        const pick = picksRef.current.get(committedLabel)
        const entry = CATALOG[background.currentPreset]
        drawDebug(text.context, frame, [
          `sem    ${!semanticsRef.current ? 'none loaded' : semanticsOnRef.current ? 'on' : 'off (neutral)'}`,
          `sect   ${section ? `${section.label} · ${section.mood} · energy ${section.energy.toFixed(2)}` : '(none)'}`,
          `commit ${committedRef.current.key}  ·  emph ${emphasis.toFixed(2)}  ·  motif ${tag ? `${motif}<-${tag}` : motif}`,
          `bg     ${mode}  ·  ${background.currentPreset}${pick?.fromFeedback ? ' (saved)' : ''}`,
          `pick   ${entry ? entry.description.slice(0, 58) : '(not in catalog)'}`,
          `why    ${pick?.reasons.join(' · ') || '—'}  ·  next ${(pick?.runnerUp ?? '—').slice(0, 26)}`,
          `text   ${physicsTextRef.current ? 'physics' : 'dom line'}  ·  voice ${eff(o.voice, textParams.voice)}  ·  layout ${eff(o.layout, textParams.layout)}  ·  anchor ${textParams.anchor}`,
          `base   in ${eff(o.entrance, textParams.entrance)}  ·  hold ${eff(o.hold, textParams.hold)}  ·  out ${eff(o.exit, textParams.exit)}`,
          `gest   ${(() => {
            if (!gesturesOnRef.current) return 'off (G)'
            if (!choreo) return '(no line)'
            const bits: string[] = []
            if (choreo.refrainOf !== null) bits.push(`refrain of line ${choreo.refrainOf + 1}`)
            if (choreo.focus.length > 0) bits.push(`focus ${choreo.focus.join(',')}`)
            for (const g of choreo.gestures)
              bits.push(`${g.gesture}@${g.index} (${g.source === 'direction' ? 'directed' : 'lexicon'})`)
            return bits.length > 0 ? bits.join('  ·  ') : 'base motion only'
          })()}`,
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
        {toast && <p className="toast">{toast.text}</p>}
        <p className="hint">
          L lyrics · T text mode · B bg · G gestures · [ ] candidate ·{' '}
          {'{ }'} browse · N ban · E/H/X parts · F voice · Y layout · 1-5/0
          combos · D debug · S semantics · K knobs
        </p>
      </main>
    </>
  )
}

export default App
