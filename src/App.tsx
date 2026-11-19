import { useState } from 'react'

// Step 1 hardcodes one song. The file lives in public/song/ (gitignored).
const AUDIO_SRC = '/song/song.mp3'

function App() {
  const [loadFailed, setLoadFailed] = useState(false)

  return (
    <main>
      <h1>Lyric Visualizer</h1>
      <audio
        controls
        src={AUDIO_SRC}
        onError={() => setLoadFailed(true)}
        onLoadedMetadata={() => setLoadFailed(false)}
      />
      {loadFailed && (
        <p role="alert">
          Couldn't load <code>{AUDIO_SRC}</code>. Put your audio file at{' '}
          <code>public{AUDIO_SRC}</code> and reload.
        </p>
      )}
    </main>
  )
}

export default App
