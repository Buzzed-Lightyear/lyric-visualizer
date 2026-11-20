import { useEffect, useState } from 'react'
import { parseIndex, type SongEntry } from './library'
import { parseFeedbackFile, type FeedbackFile } from './presetPick'
import feedbackJson from './presetFeedback.json'
import { Player } from './Player'
import { StartScreen } from './StartScreen'
import { loadAllFonts } from './voices'

const LAST_SONG_KEY = 'lyric-visualizer.lastSong'

function readLastSlug(): string | null {
  try {
    return localStorage.getItem(LAST_SONG_KEY)
  } catch {
    return null
  }
}

// The one <audio> element the whole app plays through, for the app's whole
// lifetime: createMediaElementSource binds the Web Audio graph to an element
// once and for all, so the element must outlive every song switch.
const sharedAudio = new Audio()
sharedAudio.preload = 'auto'

// The feedback file, shared by every Player so edits persist across song
// switches within a run (the dev endpoint persists them to disk).
const feedbackFile: FeedbackFile = parseFeedbackFile(feedbackJson)

/**
 * The shell: load the song index and route between the start screen and
 * the player (?song=<slug> deep-links a song).
 */
function App() {
  const [library, setLibrary] = useState<SongEntry[] | null>(null)
  const [slug, setSlug] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('song'),
  )
  useEffect(() => {
    // Canvas ctx.font never triggers CSS font loading; request every face
    // up front — the text layer refuses to draw until all are ready.
    void loadAllFonts()
    // The headless smoke test drives playback through this handle.
    ;(window as unknown as { __app: object }).__app = { audio: sharedAudio }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async (url: string): Promise<SongEntry[]> => {
      try {
        const response = await fetch(url)
        if (!response.ok) return []
        return parseIndex((await response.json()) as unknown)
      } catch {
        return []
      }
    }
    // ?fixture=1 appends the generated test songs (npm run shots makes them).
    const withFixture = new URLSearchParams(window.location.search).has('fixture')
    Promise.all([
      load('/songs/index.json'),
      withFixture ? load('/fixture/index.json') : Promise.resolve([]),
    ]).then(([songs, fixtures]) => {
      if (!cancelled) setLibrary([...songs, ...fixtures])
    })
    return () => {
      cancelled = true
    }
  }, [])

  const setSongParam = (value: string | null) => {
    const url = new URL(window.location.href)
    if (value === null) url.searchParams.delete('song')
    else url.searchParams.set('song', value)
    window.history.replaceState(null, '', url)
  }

  const open = (next: string) => {
    setSlug(next)
    setSongParam(next)
    try {
      localStorage.setItem(LAST_SONG_KEY, next)
    } catch {
      // localStorage unavailable
    }
  }

  const back = () => {
    setSlug(null)
    setSongParam(null)
  }

  if (library === null) return null // index still loading; nothing to show yet

  const song = library.find((entry) => entry.slug === slug) ?? null
  if (!song) {
    return <StartScreen library={library} lastSlug={readLastSlug()} onPick={open} />
  }
  return (
    <Player
      key={song.slug}
      song={song}
      audio={sharedAudio}
      feedback={feedbackFile}
      onBack={back}
    />
  )
}

export default App
