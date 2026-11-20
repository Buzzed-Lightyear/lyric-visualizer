import { useEffect, useRef } from 'react'
import { formatTime, type SemanticsSource, type SongEntry } from './library'

interface StartScreenProps {
  library: SongEntry[]
  lastSlug: string | null
  onPick: (slug: string) => void
}

const SOURCE_NOTE: Record<SemanticsSource, string> = {
  api: 'annotated by the API',
  agent: 'annotated by hand',
  neutral: 'neutral fallback',
}

/**
 * The start screen: the library as rows. Each row carries the song's own
 * section palette as a thin strip — the one place the otherwise monochrome
 * chrome takes color, and it comes from the song's semantics, not a theme.
 */
export function StartScreen({ library, lastSlug, onPick }: StartScreenProps) {
  const lastRef = useRef<HTMLButtonElement>(null)

  // Enter replays the remembered song without reaching for the mouse.
  useEffect(() => {
    lastRef.current?.focus()
  }, [library.length])

  return (
    <main className="start">
      <header className="start-head">
        <h1 className="wordmark">Lyric Visualizer</h1>
        <p className="tagline">The sound decides when things move. The words decide what moves.</p>
      </header>
      {library.length === 0 ? (
        <div className="start-empty">
          <p>No songs yet.</p>
          <p>
            Add one from an audio file — tags, synced lyrics and semantics are fetched for you:
          </p>
          <pre><code>npm run add-song -- path/to/song.mp3</code></pre>
        </div>
      ) : (
        <ul className="songs">
          {library.map((song) => (
            <li key={song.slug}>
              <button
                type="button"
                ref={song.slug === lastSlug ? lastRef : undefined}
                className="song-row"
                data-song={song.slug}
                onClick={() => onPick(song.slug)}
              >
                <span className="song-main">
                  <span className="song-title">{song.title}</span>
                  <span className="song-sub">
                    {song.artist}
                    {song.album ? ` — ${song.album}` : ''}
                  </span>
                  <span className="song-note">
                    {song.slug === lastSlug
                      ? `last played, ${SOURCE_NOTE[song.semantics]}`
                      : SOURCE_NOTE[song.semantics]}
                  </span>
                </span>
                <span className="song-duration">{formatTime(song.duration)}</span>
                <span className="song-strip" aria-hidden="true">
                  {(song.colors.length > 0 ? song.colors : ['#2a3142']).map((color, i) => (
                    <i key={i} style={{ background: color }} />
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {library.length > 0 && (
        <p className="start-foot">
          Add another song: <code>npm run add-song -- path/to/song.mp3</code>
        </p>
      )}
    </main>
  )
}
