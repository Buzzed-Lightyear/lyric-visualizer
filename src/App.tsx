import { useEffect, useState } from 'react'
import { parseLrc } from './lrc'

// Step 1 hardcodes one song. Both files live in public/song/ (gitignored).
const AUDIO_SRC = '/song/song.mp3'
const LRC_SRC = '/song/song.lrc'

function App() {
  const [audioFailed, setAudioFailed] = useState(false)
  const [lineCount, setLineCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(LRC_SRC)
      .then((response) => response.text())
      .then((text) => {
        if (cancelled) return
        const lines = parseLrc(text)
        console.table(lines)
        setLineCount(lines.length)
      })
      .catch(() => {
        if (!cancelled) setLineCount(0)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main>
      <h1>Lyric Visualizer</h1>
      <audio
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
      {lineCount === 0 && (
        <p role="alert">
          No timed lines found in <code>{LRC_SRC}</code>. Put your lyrics file
          at <code>public{LRC_SRC}</code> and reload.
        </p>
      )}
      {lineCount !== null && lineCount > 0 && (
        <p>Parsed {lineCount} lyric lines. The full list is in the console.</p>
      )}
    </main>
  )
}

export default App
