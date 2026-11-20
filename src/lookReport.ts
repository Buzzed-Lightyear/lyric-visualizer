/**
 * The look report: how much of its own look each song in the library
 * has. It measures and prints; it never feeds back into picking. Pure —
 * scripts/lookReport.ts reads the files and prints the result.
 *
 * Two readings of the same library:
 * - "scorer alone": every look ignored. Presets come from the scorer and
 *   voices from the mood anchors, which is what every song got before
 *   semantics version 3.
 * - "with looks": the library as it plays now, minus the owner's saved
 *   choices (those are reported separately, as overrides).
 */

import { nearestAnchor, sectionAxes } from './axes'
import {
  CATALOG,
  pickForSections,
  usablePresetNames,
  type CatalogEntry,
  type Feedback,
} from './presetPick'
import type { SemanticSection, SongLook } from './semantics'

export interface ReportSong {
  slug: string
  title: string
  artist: string
  sections: SemanticSection[]
  look: SongLook | null
  /** The owner's saved choices for this song, plus the global bans. */
  feedback: Feedback
}

export interface SongReport {
  slug: string
  title: string
  artist: string
  /** none: no look; partial: look on version 2 sections; full: version 3. */
  look: 'none' | 'partial' | 'full'
  description: string | null
  /** Who chose the presets below. */
  presetsFrom: 'model' | 'scorer'
  /** Section label -> automatic pick (saved choices left out). */
  presets: Record<string, string>
  distinctPresets: number
  /** Labels where the owner's saved choice plays instead. */
  overrides: Record<string, string>
  voices: { main: string[]; accent: string[] }
  voicesFrom: 'look' | 'mood anchors'
  palette: string[]
  moods: string[]
  imagery: string[]
}

export interface PairOverlap {
  a: string
  b: string
  shared: string[]
}

export interface LibraryReport {
  songs: SongReport[]
  /** One pick per section label, library-wide. */
  picks: number
  distinctPresets: number
  usablePresets: number
  /** Most used first. */
  topPresets: { name: string; count: number }[]
  pairs: PairOverlap[]
  pairsSharing: number
  moodTerms: string[]
  imageryTerms: string[]
  /**
   * Measured white-text readability (0..1, from the catalog) of the
   * presets picked. The scorer weighs it; the model is not shown it.
   */
  readability: { median: number; lowest: number }
}

const unique = <T>(values: Iterable<T>): T[] => [...new Set(values)]
const terms = (values: Iterable<string>) =>
  unique([...values].map((value) => value.trim().toLowerCase()).filter(Boolean)).sort()

function songReport(
  song: ReportSong,
  useLooks: boolean,
  catalog: Record<string, CatalogEntry>,
): SongReport {
  const look = useLooks ? song.look : null
  const automatic = pickForSections(
    song.sections,
    { chosen: {}, banned: song.feedback.banned },
    catalog,
    look,
  )
  const effective = pickForSections(song.sections, song.feedback, catalog, look)
  const presets: Record<string, string> = {}
  const overrides: Record<string, string> = {}
  let fromLook = 0
  for (const pick of automatic.values()) {
    if (!pick.chosen) continue
    presets[pick.label] = pick.chosen
    if (pick.source === 'look') fromLook++
    const played = effective.get(pick.label)
    if (played?.source === 'saved' && played.chosen) overrides[pick.label] = played.chosen
  }
  const anchors = song.sections.map((section) => nearestAnchor(sectionAxes(section)).anchor)
  return {
    slug: song.slug,
    title: song.title,
    artist: song.artist,
    look: !look ? 'none' : look.partial ? 'partial' : 'full',
    description: look?.description ?? null,
    presetsFrom: look && fromLook > 0 && look.presetsFrom !== 'scorer' ? 'model' : 'scorer',
    presets,
    distinctPresets: unique(Object.values(presets)).length,
    overrides,
    voices: look
      ? {
          main: unique(song.sections.map((section) => look.voices[section.voice ?? 'main'])),
          accent: [look.voices.accent],
        }
      : {
          main: unique(anchors.map((anchor) => anchor.voice)),
          accent: unique(anchors.map((anchor) => anchor.accentVoice)),
        },
    voicesFrom: look ? 'look' : 'mood anchors',
    palette: look
      ? look.palette
      : unique(song.sections.map((section) => section.palette[1] ?? section.palette[0])),
    moods: terms(song.sections.map((section) => section.mood)),
    imagery: terms(song.sections.flatMap((section) => section.imagery)),
  }
}

/** Measure the library. `useLooks: false` reads it as the scorer alone would dress it. */
export function libraryReport(
  songs: readonly ReportSong[],
  useLooks: boolean,
  catalog: Record<string, CatalogEntry> = CATALOG,
): LibraryReport {
  const reports = songs.map((song) => songReport(song, useLooks, catalog))
  const counts = new Map<string, number>()
  for (const report of reports) {
    for (const name of Object.values(report.presets)) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const pairs: PairOverlap[] = []
  for (let i = 0; i < reports.length; i++) {
    for (let j = i + 1; j < reports.length; j++) {
      const mine = new Set(Object.values(reports[i].presets))
      const shared = unique(Object.values(reports[j].presets)).filter((name) => mine.has(name)).sort()
      pairs.push({ a: reports[i].slug, b: reports[j].slug, shared })
    }
  }
  const banned = songs[0]?.feedback.banned ?? []
  const readable = reports
    .flatMap((report) => Object.values(report.presets))
    .map((name) => catalog[name]?.readability ?? 0)
    .sort((a, b) => a - b)
  return {
    songs: reports,
    picks: [...counts.values()].reduce((a, b) => a + b, 0),
    distinctPresets: counts.size,
    usablePresets: usablePresetNames({ chosen: {}, banned }, catalog).length,
    topPresets: [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    pairs,
    pairsSharing: pairs.filter((pair) => pair.shared.length > 0).length,
    moodTerms: terms(reports.flatMap((report) => report.moods)),
    imageryTerms: terms(reports.flatMap((report) => report.imagery)),
    readability: {
      median: readable.length > 0 ? readable[Math.floor(readable.length / 2)] : 0,
      lowest: readable[0] ?? 0,
    },
  }
}

const short = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text

/** One reading of the library as printable lines. */
export function formatLibrary(title: string, report: LibraryReport): string[] {
  const out: string[] = [title, '='.repeat(title.length)]
  const top = report.topPresets.slice(0, 3)
  const topSum = top.reduce((a, b) => a + b.count, 0)
  out.push(
    `${report.picks} section picks use ${report.distinctPresets} of ${report.usablePresets} usable presets; ` +
      `the three most used take ${topSum} of ${report.picks}` +
      (top.length > 0 ? ` (${top.map((t) => `${t.count}x`).join(', ')})` : ''),
  )
  out.push(
    `${report.pairsSharing} of ${report.pairs.length} song pairs share at least one preset`,
  )
  out.push(
    `${report.moodTerms.length} distinct mood terms, ${report.imageryTerms.length} distinct imagery terms in use`,
  )
  out.push(
    `measured text readability of the picks: median ${report.readability.median.toFixed(2)}, lowest ${report.readability.lowest.toFixed(2)}`,
  )
  out.push('')
  out.push('per song:')
  for (const song of report.songs) {
    const labels = Object.keys(song.presets).length
    out.push(`  ${song.slug}`)
    out.push(
      `    presets: ${song.distinctPresets} distinct for ${labels} labels (chosen by the ${song.presetsFrom}` +
        `${song.look === 'partial' ? '; look is partial' : ''})`,
    )
    const overridden = Object.keys(song.overrides).length
    if (overridden > 0) {
      out.push(`    your saved choices play instead on ${overridden} of ${labels} labels`)
    }
    out.push(
      `    voices:  main ${song.voices.main.join(', ')} / accent ${song.voices.accent.join(', ')} (from ${song.voicesFrom})`,
    )
    out.push(`    palette: ${song.palette.join(' ')}`)
    out.push(`    moods:   ${song.moods.length} (${short(song.moods.join('; '), 96)})`)
    out.push(`    imagery: ${song.imagery.length} (${short(song.imagery.join('; '), 96)})`)
  }
  out.push('')
  out.push('presets shared between songs:')
  const width = Math.max(...report.songs.map((song) => song.slug.length), 4)
  for (const pair of report.pairs) {
    out.push(
      `  ${pair.a.padEnd(width)}  ${pair.b.padEnd(width)}  ${pair.shared.length}` +
        (pair.shared.length > 0 ? `  (${pair.shared.map((name) => short(name, 34)).join(' | ')})` : ''),
    )
  }
  if (report.topPresets.length > 0) {
    out.push('')
    out.push('most used presets:')
    for (const preset of report.topPresets.filter((p) => p.count > 1).slice(0, 8)) {
      out.push(`  ${String(preset.count).padStart(2)}x  ${preset.name}`)
    }
    if (report.topPresets.every((preset) => preset.count === 1)) out.push('  (every preset is used once)')
  }
  return out
}

/** The before / after summary as printable lines. */
export function formatComparison(before: LibraryReport, after: LibraryReport): string[] {
  const top3 = (report: LibraryReport) =>
    report.topPresets.slice(0, 3).reduce((a, b) => a + b.count, 0)
  const voices = (report: LibraryReport) => {
    const counts = report.songs.map(
      (song) => unique([...song.voices.main, ...song.voices.accent]).length,
    )
    const low = Math.min(...counts)
    const high = Math.max(...counts)
    return counts.length === 0 ? '-' : low === high ? String(low) : `${low} to ${high}`
  }
  const rows: [string, string, string][] = [
    ['distinct presets', `${before.distinctPresets} of ${before.picks} picks`, `${after.distinctPresets} of ${after.picks} picks`],
    ['three most used presets take', `${top3(before)} of ${before.picks}`, `${top3(after)} of ${after.picks}`],
    ['song pairs sharing a preset', `${before.pairsSharing} of ${before.pairs.length}`, `${after.pairsSharing} of ${after.pairs.length}`],
    ['distinct mood terms', String(before.moodTerms.length), String(after.moodTerms.length)],
    ['distinct imagery terms', String(before.imageryTerms.length), String(after.imageryTerms.length)],
    ['type voices used within one song', voices(before), voices(after)],
    ['text readability of the picks, median', before.readability.median.toFixed(2), after.readability.median.toFixed(2)],
    ['text readability of the picks, lowest', before.readability.lowest.toFixed(2), after.readability.lowest.toFixed(2)],
  ]
  const w0 = Math.max(...rows.map((row) => row[0].length))
  const w1 = Math.max(...rows.map((row) => row[1].length), 'before'.length)
  return [
    'BEFORE vs AFTER',
    '===============',
    `  ${''.padEnd(w0)}  ${'before'.padEnd(w1)}  after`,
    ...rows.map((row) => `  ${row[0].padEnd(w0)}  ${row[1].padEnd(w1)}  ${row[2]}`),
  ]
}
