/**
 * Rebuild public/songs/index.json from the song folders on disk. Run as
 * `npm run index-songs`, and called by add-song after every change. The
 * index is committed: it is what the app loads at startup, and it carries
 * no lyric text (titles, times and palette colors only).
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildIndex, indexEntry, parseMeta, type SongEntry } from '../src/library'
import { parseSemantics } from '../src/semantics'

export const SONGS_DIR = path.resolve('public/songs')

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
  } catch {
    return null
  }
}

/** Scan the song folders, write index.json, return the entries. */
export function rebuildIndex(dir = SONGS_DIR): SongEntry[] {
  fs.mkdirSync(dir, { recursive: true })
  const entries: SongEntry[] = []
  for (const name of fs.readdirSync(dir).sort()) {
    const folder = path.join(dir, name)
    if (!fs.statSync(folder).isDirectory()) continue
    const metaRaw = readJson(path.join(folder, 'meta.json'))
    if (metaRaw === null) {
      console.warn(`  skipping ${name}: no readable meta.json`)
      continue
    }
    const { meta, errors } = parseMeta(metaRaw)
    if (!meta) {
      console.warn(`  skipping ${name}: ${errors.join('; ')}`)
      continue
    }
    const semanticsRaw = readJson(path.join(folder, 'semantics.json'))
    const { semantics } = semanticsRaw !== null ? parseSemantics(semanticsRaw) : { semantics: null }
    entries.push(indexEntry(name, meta, semantics))
  }
  const index = buildIndex(entries)
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n')
  return index.songs
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const songs = rebuildIndex()
  console.log(`public/songs/index.json: ${songs.length} song(s)`)
  for (const song of songs) console.log(`  ${song.slug}  (${song.semantics} semantics)`)
}
