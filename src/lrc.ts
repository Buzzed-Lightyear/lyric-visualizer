export interface LyricLine {
  /** Seconds from the start of the track, comparable to `audio.currentTime`. */
  time: number
  /** Empty for a timestamp with no words, which marks an instrumental gap. */
  text: string
}

// A leading time tag: [mm:ss], [mm:ss.xx], [mm:ss.xxx] or [mm:ss:xx].
const TIME_TAG = /^\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/
const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\s*\]$/i

/**
 * Parse line-timed LRC text into lines sorted by time.
 *
 * - A line with several time tags becomes one entry per tag.
 * - Metadata tags ([ar:], [ti:], [length:] ...) and untimed lines are skipped.
 * - [offset:] is in milliseconds; a positive value makes lyrics appear sooner.
 */
export function parseLrc(source: string): LyricLine[] {
  const entries: { ms: number; text: string }[] = []
  let offsetMs = 0

  for (const rawLine of source.replace(/^﻿/, '').split(/\r?\n/)) {
    let rest = rawLine.trim()

    const offset = OFFSET_TAG.exec(rest)
    if (offset) {
      offsetMs = Number(offset[1])
      continue
    }

    const stamps: number[] = []
    for (let tag = TIME_TAG.exec(rest); tag; tag = TIME_TAG.exec(rest)) {
      const [whole, minutes, seconds, fraction = '0'] = tag
      stamps.push(
        Number(minutes) * 60_000 +
          Number(seconds) * 1000 +
          Math.round(Number(`0.${fraction}`) * 1000),
      )
      rest = rest.slice(whole.length).trimStart()
    }

    for (const ms of stamps) entries.push({ ms, text: rest })
  }

  return entries
    .map(({ ms, text }) => ({ time: Math.max(0, ms - offsetMs) / 1000, text }))
    .sort((a, b) => a.time - b.time)
}
