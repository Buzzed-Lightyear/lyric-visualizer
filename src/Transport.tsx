import { useRef } from 'react'
import { formatTime, type SongEntry } from './library'
import type { SemanticSection } from './semantics'

interface TransportProps {
  song: SongEntry
  /** For the section markers; null until the semantics load (plain bar). */
  sections: SemanticSection[] | null
  playing: boolean
  /** Playback position in seconds (state-driven so the bar repaints). */
  time: number
  /** Seconds; the song meta's value until the audio metadata arrives. */
  duration: number
  onSeek: (seconds: number) => void
  onTogglePlay: () => void
  onBack: () => void
  onHelp: () => void
}

const PlayIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
  </svg>
)

const PauseIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path d="M7.5 5.5h3.4v13H7.5zm5.6 0h3.4v13h-3.4z" fill="currentColor" />
  </svg>
)

const BackIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path
      d="M14.5 5.5 8 12l6.5 6.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const FullscreenIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/**
 * The playback chrome: back, title, fullscreen along the top; play/pause,
 * a scrub bar with section markers in each section's accent color, and the
 * times along the bottom. Fading is handled by the parent (.player-idle).
 */
export function Transport({
  song,
  sections,
  playing,
  time,
  duration,
  onSeek,
  onTogglePlay,
  onBack,
  onHelp,
}: TransportProps) {
  const barRef = useRef<HTMLDivElement>(null)
  const frac = duration > 0 ? Math.min(1, time / duration) : 0

  const seekTo = (clientX: number) => {
    const bar = barRef.current
    if (!bar || !(duration > 0)) return
    const rect = bar.getBoundingClientRect()
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    onSeek(f * duration)
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    seekTo(event.clientX)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) seekTo(event.clientX)
  }

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen()
  }

  return (
    <>
      <header className="topbar">
        <button
          type="button"
          className="chrome-button"
          data-action="back"
          onClick={onBack}
          aria-label="Back to songs"
        >
          {BackIcon}
        </button>
        <div className="now-playing">
          <span className="now-title">{song.title}</span>
          <span className="now-artist">{song.artist}</span>
        </div>
        <button
          type="button"
          className="chrome-button"
          data-action="fullscreen"
          onClick={toggleFullscreen}
          aria-label="Fullscreen"
        >
          {FullscreenIcon}
        </button>
      </header>
      <footer className="transport" data-testid="transport">
        <button
          type="button"
          className="chrome-button play-button"
          data-action="play"
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? PauseIcon : PlayIcon}
        </button>
        <span className="time time-elapsed">{formatTime(time)}</span>
        <div
          ref={barRef}
          className="scrub"
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={formatTime(time)}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
        >
          <div className="scrub-track">
            {(sections ?? []).map((section, i) =>
              duration > 0 ? (
                <span
                  key={i}
                  className="scrub-section"
                  style={{
                    left: `${(section.start / duration) * 100}%`,
                    width: `${(Math.min(section.end, duration) - section.start) / duration * 100}%`,
                    background: section.palette[1] ?? section.palette[0],
                  }}
                />
              ) : null,
            )}
          </div>
          <div className="scrub-dim" style={{ left: `${frac * 100}%` }} />
          <div className="scrub-head" style={{ left: `${frac * 100}%` }} />
        </div>
        <span className="time time-total">{formatTime(duration)}</span>
        <button
          type="button"
          className="chrome-button help-button"
          data-action="help"
          onClick={onHelp}
          aria-label="Keyboard shortcuts"
        >
          ?
        </button>
      </footer>
    </>
  )
}
