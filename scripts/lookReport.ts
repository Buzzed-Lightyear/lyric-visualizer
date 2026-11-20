/**
 * npm run look-report [-- --before <git ref>] [--out <file>]
 *
 * Prints how much of its own look each song in the library has: distinct
 * presets per song, the presets every pair of songs shares, how many
 * distinct mood and imagery terms are in use, and each song's voices and
 * palette. Before and after:
 *
 * - BEFORE is the library dressed by the scorer alone — looks ignored,
 *   voices from the mood anchors, which is what every song got before
 *   semantics version 3. With --before <git ref> it is read from the song
 *   files at that commit instead (the true earlier state).
 * - AFTER is the library on disk, with its looks.
 *
 * A report, not a tuner: nothing here feeds back into picking.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseMeta } from '../src/library'
import {
  formatComparison,
  formatLibrary,
  libraryReport,
  type ReportSong,
} from '../src/lookReport'
import { feedbackFor, parseFeedbackFile, type FeedbackFile } from '../src/presetPick'
import { parseSemantics } from '../src/semantics'

const SONGS = 'public/songs'
const FEEDBACK = 'src/presetFeedback.json'

const args = process.argv.slice(2)
const argValue = (name: string): string | null => {
  const i = args.indexOf(name)
  return i >= 0 ? (args[i + 1] ?? null) : null
}
const beforeRef = argValue('--before')
const outFile = argValue('--out')

type Read = (file: string) => string | null

const fromDisk: Read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null)

const fromGit =
  (ref: string): Read =>
  (file) => {
    try {
      return execFileSync('git', ['show', `${ref}:${file}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      })
    } catch {
      return null
    }
  }

function slugsOnDisk(): string[] {
  if (!fs.existsSync(SONGS)) return []
  return fs
    .readdirSync(SONGS)
    .filter((name) => fs.statSync(path.join(SONGS, name)).isDirectory())
    .sort()
}

function slugsInGit(ref: string): string[] {
  try {
    return execFileSync('git', ['ls-tree', '-d', '--name-only', `${ref}:${SONGS}`], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .sort()
  } catch {
    return []
  }
}

function loadLibrary(slugs: string[], read: Read): ReportSong[] {
  const parseJson = (text: string | null): unknown => {
    if (text === null) return null
    try {
      return JSON.parse(text) as unknown
    } catch {
      return null
    }
  }
  const feedbackFile: FeedbackFile = parseFeedbackFile(parseJson(read(FEEDBACK)))
  const songs: ReportSong[] = []
  for (const slug of slugs) {
    const { meta } = parseMeta(parseJson(read(`${SONGS}/${slug}/meta.json`)))
    const { semantics } = parseSemantics(parseJson(read(`${SONGS}/${slug}/semantics.json`)))
    if (!meta || !semantics) {
      console.warn(`  skipping ${slug}: no readable meta.json + semantics.json`)
      continue
    }
    // The neutral fallback has no annotation to measure.
    if (meta.semantics === 'neutral') continue
    songs.push({
      slug,
      title: meta.title,
      artist: meta.artist,
      sections: semantics.sections,
      look: semantics.look ?? null,
      feedback: feedbackFor(feedbackFile, slug),
    })
  }
  return songs
}

const current = loadLibrary(slugsOnDisk(), fromDisk)
if (current.length === 0) {
  console.log('look-report: no annotated songs under public/songs/')
  process.exit(0)
}

const before = beforeRef
  ? libraryReport(loadLibrary(slugsInGit(beforeRef), fromGit(beforeRef)), true)
  : libraryReport(current, false)
const after = libraryReport(current, true)

const lines = [
  ...formatComparison(before, after),
  '',
  ...formatLibrary(
    beforeRef
      ? `BEFORE: the library at ${beforeRef}`
      : 'BEFORE: the scorer alone (looks ignored, voices from the mood anchors)',
    before,
  ),
  '',
  ...formatLibrary('AFTER: the library with its looks', after),
]
console.log(lines.join('\n'))
if (outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, lines.join('\n') + '\n')
  console.log(`\nwritten to ${outFile}`)
}
