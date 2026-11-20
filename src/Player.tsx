import { useEffect, useRef, useState } from 'react'
import { AudioAnalysis } from './analysis'
import { Background } from './background'
import { BackdropSampler } from './backdrop'
import { buildChoreo, lineWords, type LineChoreo } from './choreo'
import { SectionCommitter } from './committer'
import { drawDebug } from './debug'
import { createKnobs, type Knobs } from './knobs'
import { LAYOUT_NAMES } from './layout'
import { onsetsForLine, parseWordTimes, type SongEntry, type WordTimes } from './library'
import { activeLineIndex, parseLrc, type LyricLine } from './lrc'
import {
  motifForSection,
  paramsForSection,
  sectionGrammar,
  textParamsForLine,
  type LineMotion,
} from './mapping'
import { COMBO_NAMES, COMBOS, ENTRANCE_NAMES, EXIT_NAMES, HOLD_NAMES } from './parts'
import {
  CATALOG,
  CATALOG_NAMES,
  feedbackFor,
  isUsable,
  pickForSections,
  rankForSection,
  type FeedbackFile,
  type LabelPick,
} from './presetPick'
import {
  clearKept,
  dropPreviewsOf,
  keepPreset,
  newPreviewState,
  playingPreset,
  stepPreview,
} from './presetKeys'
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
import { HelpSheet } from './HelpSheet'
import { Transport } from './Transport'
import { BUTTERCHURN } from './tuning'
import { VOICE_NAMES } from './voices'

/**
 * Corrects constant lag between audio and lyrics, in seconds.
 * Positive shows each line earlier; negative shows it later.
 */
const LYRIC_OFFSET_SECONDS = 0

/** Idle seconds before the controls fade out during playback. */
const CONTROLS_IDLE_SEC = 3.5

interface Committed {
  key: string
  energy: number
  section: SemanticSection | null
}

interface PlayerProps {
  song: SongEntry
  audio: HTMLAudioElement
  /** The whole feedback file; this song's choices live under its slug. */
  feedback: FeedbackFile
  onBack: () => void
}

/**
 * One mounted Player per song (keyed by slug in App), so switching songs
 * rebuilds the text physics, the background and all per-song state from
 * scratch — nothing can leak across.
 */
export function Player({ song, audio, feedback, onBack }: PlayerProps) {
  const [audioFailed, setAudioFailed] = useState(false)
  const [lines, setLines] = useState<LyricLine[] | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [showLyrics, setShowLyrics] = useState(true)
  const [physicsText, setPhysicsText] = useState(true)
  const [semanticsErrors, setSemanticsErrors] = useState(0)
  const [sections, setSections] = useState<SemanticSection[] | null>(null)
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null)
  const [playing, setPlaying] = useState(!audio.paused)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(song.duration)
  const [controlsShown, setControlsShown] = useState(true)
  const [helpOpen, setHelpOpen] = useState(false)
  const bgCanvasRef = useRef<HTMLCanvasElement>(null)
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null)
  const textCanvasRef = useRef<HTMLCanvasElement>(null)
  // The loop reads these refs so it never restarts, and canvas concerns
  // never pass through React state.
  const linesRef = useRef<LyricLine[]>([])
  const semanticsRef = useRef<Semantics | null>(null)
  const wordsRef = useRef<WordTimes | null>(null)
  const semanticsOnRef = useRef(true)
  const debugRef = useRef(false)
  const showLyricsRef = useRef(true)
  const physicsTextRef = useRef(true)
  const helpOpenRef = useRef(false)
  const overridesRef = useRef<PartOverrides>({})
  const choreoRef = useRef<LineChoreo[]>([])
  const gesturesOnRef = useRef(true)
  const feedbackRef = useRef(feedback)
  const picksRef = useRef<Map<string, LabelPick>>(new Map())
  // [ ] previews live here only: nothing is saved until P.
  const previewRef = useRef(newPreviewState())
  const browseIndexRef = useRef(-1)
  const backgroundRef = useRef<Background | null>(null)
  const committedRef = useRef<Committed>({ key: 'neutral', energy: 0.5, section: null })
  const knobsRef = useRef<Knobs | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    const fb = feedbackFor(feedbackRef.current, song.slug)
    const map = semantics
      ? pickForSections(semantics.sections, fb, CATALOG, semantics.look ?? null)
      : new Map<string, LabelPick>()
    const candidates = rankForSection(null, fb)
    const saved = fb.chosen['neutral']
    const chosen = saved && isUsable(saved, fb) ? saved : (candidates[0]?.name ?? null)
    const scored = candidates.find((c) => c.name === chosen)
    map.set('neutral', {
      label: 'neutral',
      candidates,
      chosen,
      source: saved && isUsable(saved, fb) ? 'saved' : 'scorer',
      fromFeedback: Boolean(saved && isUsable(saved, fb)),
      reasons: scored?.reasons ?? [],
      runnerUp: candidates.find((c) => c.name !== chosen)?.name ?? null,
    })
    picksRef.current = map
  }

  const loadForLabel = (label: string, blendSec: number) => {
    const name = playingPreset(picksRef.current.get(label), previewRef.current)
    if (name) backgroundRef.current?.loadByName(name, blendSec)
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

  // The dev tuning panel, with the feedback reset living next to the knobs.
  useEffect(() => {
    const knobs = createKnobs({
      resetPresetFeedback: () => {
        feedbackRef.current.songs[song.slug] = {}
        feedbackRef.current.banned = []
        recomputePicks()
        saveFeedback()
        showToast('preset feedback reset (this song + bans)')
      },
      clearKeptChoices: () => {
        const { cleared, message } = clearKept(feedbackRef.current, song.slug)
        recomputePicks()
        if (cleared > 0) saveFeedback()
        loadForLabel(committedRef.current.section?.label ?? 'neutral', BUTTERCHURN.cycleBlend)
        showToast(message)
      },
    })
    knobsRef.current = knobs
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

  // The song's audio: one shared element app-wide; this mount points it at
  // this song and fully resets playback.
  useEffect(() => {
    const src = song.base + song.audio
    const onError = () => setAudioFailed(true)
    const onLoaded = () => {
      setAudioFailed(false)
      if (audio.duration > 0) setDuration(audio.duration)
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onTime = () => setTime(audio.currentTime)
    audio.addEventListener('error', onError)
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('seeking', onTime)
    if (!audio.src.endsWith(src)) {
      audio.src = src
      audio.load()
    }
    setTime(audio.currentTime)
    return () => {
      audio.pause()
      audio.removeEventListener('error', onError)
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('seeking', onTime)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The song's files. A missing words.json or semantics.json is fine (the
  // song plays with estimates / the neutral look).
  useEffect(() => {
    let cancelled = false
    fetch(song.base + 'lyrics.lrc')
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
    fetch(song.base + 'words.json')
      .then((response) => (response.ok ? response.json() : null))
      .then((json: unknown) => {
        if (!cancelled && json) wordsRef.current = parseWordTimes(json)
      })
      .catch(() => {})
    fetch(song.base + 'semantics.json')
      .then(async (response) => {
        if (!response.ok || cancelled) return // no file: neutral look
        let json: unknown
        try {
          json = await response.json()
        } catch {
          console.error(`${song.base}semantics.json is not valid JSON; running neutral`)
          if (!cancelled) setSemanticsErrors(1)
          return
        }
        const { semantics, errors } = parseSemantics(json)
        if (errors.length > 0) {
          console.error(`${song.base}semantics.json has ${errors.length} problem(s); running neutral:`)
          for (const error of errors) console.error(`  - ${error}`)
        }
        if (cancelled) return
        semanticsRef.current = semantics
        recomputePicks()
        rebuildChoreo()
        setSemanticsErrors(errors.length)
        setSections(semantics?.sections ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Controls fade out after a few idle seconds during playback and return
  // on any mouse move or key press.
  useEffect(() => {
    const wake = () => {
      setControlsShown(true)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(() => {
        if (!audio.paused && !helpOpenRef.current) setControlsShown(false)
      }, CONTROLS_IDLE_SEC * 1000)
    }
    wake()
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    window.addEventListener('keydown', wake)
    audio.addEventListener('pause', wake)
    audio.addEventListener('play', wake)
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', wake)
      audio.removeEventListener('pause', wake)
      audio.removeEventListener('play', wake)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    helpOpenRef.current = helpOpen
  }, [helpOpen])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // Typing in the knobs panel must not trigger app keys.
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, select, [contenteditable]')
      ) {
        return
      }
      if (event.key === '?') {
        setHelpOpen((open) => !open)
        return
      }
      if (event.key === 'Escape') {
        setHelpOpen(false)
        return
      }
      if (event.key === ' ') {
        event.preventDefault()
        if (audio.paused) void audio.play()
        else audio.pause()
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const dir = event.key === 'ArrowRight' ? 5 : -5
        audio.currentTime = Math.max(0, Math.min(audio.duration || song.duration, audio.currentTime + dir))
        return
      }
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
        // Preview only: nothing is saved, and it ends when the song reloads.
        const label = committedRef.current.section?.label ?? 'neutral'
        const step = stepPreview(
          picksRef.current.get(label),
          previewRef.current,
          event.key === ']' ? 1 : -1,
        )
        if (step) {
          backgroundRef.current?.loadByName(step.name, BUTTERCHURN.cycleBlend)
          showToast(step.message)
        }
      }
      if (key === 'p') {
        // Keep the preset on screen for this section label in this song.
        const label = committedRef.current.section?.label ?? 'neutral'
        const onScreen = backgroundRef.current?.currentPreset ?? null
        const result = keepPreset(
          feedbackRef.current,
          song.slug,
          label,
          onScreen === '(none)' ? null : onScreen,
          previewRef.current,
        )
        if (result.kept) {
          recomputePicks()
          saveFeedback()
        }
        showToast(result.message)
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
          showToast(
            `Browsing ${browseIndexRef.current + 1} of ${CATALOG_NAMES.length}, not saved. P to keep. ${name}`,
          )
        }
      }
      if (key === 'n') {
        const name = backgroundRef.current?.currentPreset
        if (name && name !== '(none)') {
          const fb = feedbackFor(feedbackRef.current, song.slug)
          if (!fb.banned.includes(name)) fb.banned.push(name)
          // Bans are global: clear the preset wherever any song chose it.
          for (const chosen of Object.values(feedbackRef.current.songs)) {
            for (const [label, pick] of Object.entries(chosen)) {
              if (pick === name) delete chosen[label]
            }
          }
          const label = committedRef.current.section?.label ?? 'neutral'
          dropPreviewsOf(previewRef.current, name)
          previewRef.current.index.delete(label)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // One loop per frame: sample the audio, commit section changes on the
  // beat, render the background, the text physics, and the debug overlay.
  // Everything derives from currentTime, so pause and seek just work.
  useEffect(() => {
    const bgCanvas = bgCanvasRef.current
    const sceneCanvas = sceneCanvasRef.current
    const textCanvas = textCanvasRef.current
    if (!bgCanvas || !sceneCanvas || !textCanvas) return

    const analysis = new AudioAnalysis(audio)
    const scene = new Scene(sceneCanvas, createRandom(1337))
    const text = new TextLayer(textCanvas, createRandom(4242))
    const background = new Background(bgCanvas, audio)
    backgroundRef.current = background
    // A small sample of whatever is behind the text, for readability.
    const backdrop = new BackdropSampler()
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
      // Sample right after the background rendered, while its frame is
      // still in the drawing buffer.
      backdrop.update(mode === 'butterchurn' ? bgCanvas : mode === 'scene' ? sceneCanvas : null)

      // Text layer (plus scrim/tint, which it always draws).
      const committedSection = committedRef.current.section
      const lyrics = linesRef.current
      // The base grammar follows the beat-committed section; a refrain
      // keeps its source line's grammar. G drops focus and gestures.
      const choreo = lineIndex >= 0 ? choreoRef.current[lineIndex] : undefined
      // The song's two type voices come from its look (semantics v3).
      const look = semantics?.look ?? null
      let motion: LineMotion = {}
      if (semantics && choreo) {
        motion = gesturesOnRef.current
          ? {
              grammar:
                choreo.refrainOf !== null
                  ? choreo.grammar
                  : sectionGrammar(committedSection, look),
              focus: choreo.focus,
              gestures: choreo.gestures,
            }
          : { grammar: sectionGrammar(committedSection, look) }
      }
      const textParams = textParamsForLine(committedSection, emphasis, motion, look)
      const line =
        physicsTextRef.current && showLyricsRef.current && lineIndex >= 0
          ? {
              index: lineIndex,
              text: lyrics[lineIndex].text,
              start: lyrics[lineIndex].time,
              end: lyrics[lineIndex + 1]?.time ?? lyrics[lineIndex].time + 4,
              onsets: onsetsForLine(
                wordsRef.current,
                lyrics[lineIndex].time,
                lineWords(lyrics[lineIndex].text).length,
              ),
            }
          : null
      text.draw(
        frame,
        {
          params: textParams,
          line,
          time: t,
          overrides: overridesRef.current,
          backdrop: backdrop.backdrop,
        },
        dt,
      )

      if (debugRef.current) {
        const { motif, tag } = motifForSection(section)
        const o = overridesRef.current
        const eff = (over: string | null | undefined, mapped: string) =>
          over ? `${over} (forced)` : mapped
        const committedLabel = committedRef.current.section?.label ?? 'neutral'
        const pick = picksRef.current.get(committedLabel)
        const entry = CATALOG[background.currentPreset]
        drawDebug(text.context, frame, [
          `song   ${song.slug}  ·  words ${wordsRef.current ? `${wordsRef.current.lines.length} lines synced` : 'estimated'}`,
          `sem    ${!semanticsRef.current ? 'none loaded' : semanticsOnRef.current ? 'on' : 'off (neutral)'}`,
          `sect   ${section ? `${section.label} · ${section.mood} · energy ${section.energy.toFixed(2)}` : '(none)'}`,
          `commit ${committedRef.current.key}  ·  emph ${emphasis.toFixed(2)}  ·  motif ${tag ? `${motif}<-${tag}` : motif}`,
          `bg     ${mode}  ·  ${background.currentPreset}${pick?.source === 'saved' ? ' (saved)' : pick?.source === 'look' ? ' (look)' : ''}`,
          `pick   ${entry ? entry.description.slice(0, 58) : '(not in catalog)'}`,
          `why    ${pick?.reasons.join(' · ') || '—'}  ·  next ${(pick?.runnerUp ?? '—').slice(0, 26)}`,
          `text   ${physicsTextRef.current ? 'physics' : 'dom line'}  ·  voice ${eff(o.voice, textParams.voice)}  ·  layout ${eff(o.layout, textParams.layout)}  ·  anchor ${textParams.anchor}`,
          `read   ${(() => {
            const read = text.legibility()
            if (!read) return '(no line)'
            if (read.mode === 'scrim') return 'old scrim (K › readable text › oldScrim)'
            return (
              `${read.polarity} text  ·  backing ${read.strength.toFixed(2)}  ·  accent ${read.accent ? 'on' : 'off'}` +
              `  ·  behind ${read.stats.lo.toFixed(2)}–${read.stats.hi.toFixed(2)}  ·  sample ${backdrop.lastMs.toFixed(1)}ms`
            )
          })()}`,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeLine = lines && activeIndex >= 0 ? lines[activeIndex] : null

  return (
    <div className={controlsShown ? 'player' : 'player player-idle'}>
      <canvas ref={bgCanvasRef} className="bg" aria-hidden="true" />
      <canvas ref={sceneCanvasRef} className="scene" aria-hidden="true" />
      <canvas ref={textCanvasRef} className="text" aria-hidden="true" />
      <div className="notices">
        {audioFailed && (
          <p role="alert">
            The audio didn't load. Expected it at <code>public{song.base}{song.audio}</code> —
            put the file there (or rerun add-song) and reload.
          </p>
        )}
        {lines !== null && lines.length === 0 && !audioFailed && (
          <p role="alert">
            No timed lyrics found at <code>public{song.base}lyrics.lrc</code>. Fetch them with{' '}
            <code>npm run add-song -- --song {song.slug} --lyrics</code>.
          </p>
        )}
        {semanticsErrors > 0 && (
          <p role="alert">
            <code>{song.base}semantics.json</code> has {semanticsErrors} problem
            {semanticsErrors === 1 ? '' : 's'} (details in the console). Running the neutral look.
          </p>
        )}
      </div>
      {!physicsText && (
        <p
          className="lyric-line"
          style={{ visibility: showLyrics ? 'visible' : 'hidden' }}
        >
          {activeLine?.text ?? ' '}
        </p>
      )}
      {toast && <p className="toast">{toast.text}</p>}
      <Transport
        song={song}
        sections={sections}
        playing={playing}
        time={time}
        duration={duration}
        onSeek={(seconds) => {
          audio.currentTime = seconds
        }}
        onTogglePlay={() => {
          if (audio.paused) void audio.play()
          else audio.pause()
        }}
        onBack={onBack}
        onHelp={() => setHelpOpen(true)}
      />
      {helpOpen && <HelpSheet onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
