/**
 * Generate the made-up fixture songs the headless checks run on, under
 * public/fixture/ (gitignored): a generated tone as audio, invented
 * lyrics, hand-written semantics and a fixture index. With these, the
 * picker, song switching and the transport are testable on any machine
 * without the owner's files, and the harness has semantics to render even
 * when the library is empty.
 *
 * The app only lists them when the URL carries ?fixture=1.
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const RATE = 22050

/** A 16-bit mono WAV of layered sines with a 2 Hz pulse, so the analyser
 * sees both spectrum and beats. */
function toneWav(seconds, baseHz) {
  const n = Math.round(seconds * RATE)
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    const pulse = 0.55 + 0.45 * Math.max(0, Math.sin(2 * Math.PI * 2 * t)) ** 2
    const sweep = baseHz * (1 + 0.25 * Math.sin(2 * Math.PI * t * 0.11))
    const s =
      0.5 * Math.sin(2 * Math.PI * sweep * t) +
      0.3 * Math.sin(2 * Math.PI * sweep * 1.5 * t) +
      0.2 * Math.sin(2 * Math.PI * sweep * 0.5 * t)
    const v = Math.round(s * pulse * 0.6 * 32767)
    data.writeInt16LE(Math.max(-32768, Math.min(32767, v)), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const stamp = (sec) => {
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(2).padStart(5, '0')
  return `[${String(m).padStart(2, '0')}:${s}]`
}

const lrc = (lines) => lines.map(([t, text]) => `${stamp(t)} ${text}`).join('\n') + '\n'

// Invented lines only — no real lyrics anywhere near the fixtures.
const SONG_A = {
  slug: 'fixture-a',
  meta: {
    title: 'Paper Planets',
    artist: 'Fixture Ensemble',
    album: 'Harness Tapes',
    duration: 24,
    audio: 'audio.wav',
    semantics: 'agent',
  },
  baseHz: 220,
  lines: [
    [1.0, 'fold the paper planets slowly'],
    [3.4, 'send them sailing off the table'],
    [5.8, 'every orbit is invented'],
    [8.2, 'gravity was never able'],
    [11.0, 'rise above the kitchen window'],
    [13.4, 'glide across the garden wall'],
    [15.8, ''],
    [17.4, 'fold the paper planets slowly'],
    [19.8, 'watch the little giants fall'],
  ],
  semantics: {
    version: 2,
    sections: [
      {
        start: 0,
        end: 10.5,
        label: 'verse',
        energy: 0.45,
        mood: 'calm',
        palette: ['#0a0c14', '#5aa7c7', '#cfe4f0'],
        imagery: ['stars'],
      },
      {
        start: 10.5,
        end: 17,
        label: 'lift',
        energy: 0.7,
        mood: 'suspended',
        palette: ['#0c1020', '#d9a441', '#f0e3c0'],
        imagery: ['night-sky'],
      },
      {
        start: 17,
        end: 24,
        label: 'verse',
        energy: 0.45,
        mood: 'calm',
        palette: ['#0a0c14', '#5aa7c7', '#cfe4f0'],
        imagery: ['stars'],
      },
    ],
    lines: [
      { time: 1.0, emphasis: 0.5, focus: [2, 3] },
      { time: 3.4, emphasis: 0.55, focus: [2] },
      { time: 5.8, emphasis: 0.5, focus: [1] },
      { time: 8.2, emphasis: 0.5, focus: [0] },
      { time: 11.0, emphasis: 0.7, focus: [0], gesture: 'rise' },
      { time: 13.4, emphasis: 0.6, focus: [0] },
      { time: 17.4, emphasis: 0.5 },
      { time: 19.8, emphasis: 0.75, focus: [4], gesture: 'fall' },
    ],
  },
}

const SONG_B = {
  slug: 'fixture-b',
  meta: {
    title: 'Static Garden',
    artist: 'Fixture Ensemble',
    album: 'Harness Tapes',
    duration: 16,
    audio: 'audio.wav',
    semantics: 'neutral',
  },
  baseHz: 165,
  lines: [
    [0.8, 'plastic flowers in the static'],
    [3.0, 'humming wires start to bloom'],
    [5.2, 'tune the weather on the antenna'],
    [7.4, 'grow a garden in this room'],
    [10.5, 'plastic flowers in the static'],
    [12.7, 'every channel is in bloom'],
  ],
  semantics: {
    version: 2,
    sections: [
      {
        start: 0,
        end: 9,
        label: 'part 1',
        energy: 0.5,
        mood: 'neutral',
        palette: ['#0a0c12', '#5a6b8f', '#9aa7bf'],
        imagery: [],
      },
      {
        start: 9,
        end: 16,
        label: 'part 2',
        energy: 0.5,
        mood: 'neutral',
        palette: ['#0a0c12', '#8f5a74', '#bf9aae'],
        imagery: [],
      },
    ],
    lines: SONG_B_LINES(),
  },
}

function SONG_B_LINES() {
  return [0.8, 3.0, 5.2, 7.4, 10.5, 12.7].map((time) => ({ time, emphasis: 0.5 }))
}

export const FIXTURE_DIR = path.resolve('public/fixture')

export function makeFixture(force = false) {
  for (const song of [SONG_A, SONG_B]) {
    const dir = path.join(FIXTURE_DIR, song.slug)
    if (!force && fs.existsSync(path.join(dir, 'meta.json'))) continue
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'audio.wav'), toneWav(song.meta.duration, song.baseHz))
    fs.writeFileSync(path.join(dir, 'lyrics.lrc'), lrc(song.lines))
    fs.writeFileSync(path.join(dir, 'semantics.json'), JSON.stringify(song.semantics, null, 2))
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(song.meta, null, 2))
  }
  const index = {
    version: 1,
    songs: [SONG_A, SONG_B].map((song) => ({
      slug: song.slug,
      base: `/fixture/${song.slug}/`,
      ...song.meta,
      colors: song.semantics.sections.map((s) => s.palette[1]),
    })),
  }
  fs.writeFileSync(path.join(FIXTURE_DIR, 'index.json'), JSON.stringify(index, null, 2))
  return index
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  makeFixture(true)
  console.log(`wrote fixture songs to ${FIXTURE_DIR}`)
}
