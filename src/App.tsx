import { useEffect, useRef, useState } from 'react'
import { activeLineIndex, parseLrc, type LyricLine } from './lrc'

// Step 1 hardcodes one song. Both files live in public/song/ (gitignored).
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
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch(LRC_SRC)
      .then((response) => (response.ok ? response.text() : ''))
      .then((text) => {
        if (!cancelled) setLines(parseLrc(text))
      })
      .catch(() => {
        if (!cancelled) setLines([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Derive the active line from currentTime every frame, so pause and
  // seek need no special handling. timeupdate fires too coarsely.
  useEffect(() => {
    if (!lines || lines.length === 0) return
    let frame = requestAnimationFrame(function tick() {
      const audio = audioRef.current
      if (audio) {
        setActiveIndex(
          activeLineIndex(lines, audio.currentTime + LYRIC_OFFSET_SECONDS),
        )
      }
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [lines])

  const activeLine = lines && activeIndex >= 0 ? lines[activeIndex] : null

  return (
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
          No timed lines found in <code>{LRC_SRC}</code>. Put your lyrics file
          at <code>public{LRC_SRC}</code> and reload.
        </p>
      )}
      <p className="lyric-line">{activeLine?.text ?? ' '}</p>
    </main>
  )
}

export default App
