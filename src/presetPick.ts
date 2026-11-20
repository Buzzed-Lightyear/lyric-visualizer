/**
 * Background preset picking, one preset per section label.
 *
 * Who decides, in order: the owner's saved choice (] [), then the song's
 * look (semantics version 3: the model chose one cohesive set for the
 * song, look.presets), then the scorer. The scorer rates every usable
 * catalog preset against a section (mood axes, energy, palette, imagery,
 * readability, quality); it is the fallback when a song has no look or a
 * look's preset cannot play, and it supplies the candidates the ] [ keys
 * cycle through after the look's pick.
 *
 * Guardrails, whoever decides: banned, broken, blank and hard-strobing
 * presets never play; sections with the same label share one preset;
 * automatic picks never repeat on neighbouring sections; same inputs
 * give the same picks. A set the model proposes must also give every
 * label its own preset (presetSetProblems).
 */

import { sectionAxes, type MoodAxes } from './axes'
import type { Rgb } from './mapping'
import catalogJson from './presetCatalog.json'
import type { SemanticSection, SongLook } from './semantics'
import { PRESET_SCORE } from './tuning'

export interface CatalogEntry {
  slug: string
  colors: [number, number, number][]
  brightness: number
  saturation: number
  motion: number
  detail: number
  beatResponse: number
  flicker: number
  readability: number
  costMs: number
  flags: string[]
  description: string
  axes: MoodAxes
  imagery: string[]
  quality: number
}

interface CatalogFile {
  _meta: Record<string, unknown>
  presets: Record<string, CatalogEntry>
}

export const CATALOG: Record<string, CatalogEntry> = (catalogJson as unknown as CatalogFile)
  .presets
export const CATALOG_NAMES: string[] = Object.keys(CATALOG).sort()

export interface Feedback {
  /** Section label -> preset the owner chose with ] and [. */
  chosen: Record<string, string>
  /** Presets that must never play again (N key). */
  banned: string[]
}

/**
 * src/presetFeedback.json: preset choices are per song (keyed by slug);
 * bans are global.
 */
export interface FeedbackFile {
  version: 2
  songs: Record<string, Record<string, string>>
  banned: string[]
}

/** Tolerant load; a v1 file ({ chosen, banned }) keeps only its bans. */
export function parseFeedbackFile(input: unknown): FeedbackFile {
  const file: FeedbackFile = { version: 2, songs: {}, banned: [] }
  if (typeof input !== 'object' || input === null) return file
  const raw = input as Record<string, unknown>
  if (Array.isArray(raw.banned)) {
    file.banned = raw.banned.filter((b): b is string => typeof b === 'string')
  }
  if (raw.version === 2 && typeof raw.songs === 'object' && raw.songs !== null) {
    for (const [slug, chosen] of Object.entries(raw.songs as Record<string, unknown>)) {
      if (typeof chosen !== 'object' || chosen === null) continue
      const clean: Record<string, string> = {}
      for (const [label, name] of Object.entries(chosen as Record<string, unknown>)) {
        if (typeof name === 'string') clean[label] = name
      }
      file.songs[slug] = clean
    }
  }
  return file
}

/** The per-song view the picker works on. Mutations write through. */
export function feedbackFor(file: FeedbackFile, slug: string): Feedback {
  file.songs[slug] ??= {}
  return { chosen: file.songs[slug], banned: file.banned }
}

/** Flags that disqualify a preset outright. */
const FATAL_FLAGS = new Set(['error', 'blank', 'strobe'])

export function isUsable(
  name: string,
  feedback: Feedback,
  catalog: Record<string, CatalogEntry> = CATALOG,
): boolean {
  const entry = catalog[name]
  if (!entry) return false
  if (entry.flags.some((flag) => FATAL_FLAGS.has(flag))) return false
  return !feedback.banned.includes(name)
}

/** Every preset that may play, in name order. */
export function usablePresetNames(
  feedback: Feedback,
  catalog: Record<string, CatalogEntry> = CATALOG,
): string[] {
  return Object.keys(catalog)
    .sort()
    .filter((name) => isUsable(name, feedback, catalog))
}

/**
 * The guardrails on a preset set proposed for a song (by the model in
 * add-song, or by hand): every label has a preset; every name exists;
 * nothing banned, broken, blank or hard-strobing; no preset serves two
 * different labels. Returns one readable message per problem.
 */
export function presetSetProblems(
  presets: Readonly<Record<string, string>>,
  labels: readonly string[],
  feedback: Feedback,
  catalog: Record<string, CatalogEntry> = CATALOG,
): string[] {
  const problems: string[] = []
  const wanted = [...new Set(labels)]
  for (const label of wanted) {
    if (!Object.hasOwn(presets, label)) problems.push(`no preset chosen for "${label}"`)
  }
  const usedBy = new Map<string, string>()
  for (const [label, name] of Object.entries(presets)) {
    if (!wanted.includes(label)) {
      problems.push(`"${label}" is not a section label of this song`)
      continue
    }
    const entry = Object.hasOwn(catalog, name) ? catalog[name] : undefined
    if (!entry) {
      problems.push(`"${name}" (for "${label}") is not a preset in the list; copy names exactly`)
      continue
    }
    const fatal = entry.flags.filter((flag) => FATAL_FLAGS.has(flag))
    if (fatal.length > 0) {
      problems.push(`"${name}" (for "${label}") is flagged ${fatal.join(', ')} and never plays`)
    } else if (feedback.banned.includes(name)) {
      problems.push(`"${name}" (for "${label}") is banned by the owner`)
    }
    const other = usedBy.get(name)
    if (other !== undefined) {
      problems.push(`"${name}" is chosen for both "${other}" and "${label}"; each label needs its own preset`)
    } else {
      usedBy.set(name, label)
    }
  }
  return problems
}

/** Section imagery vocabulary -> catalog tag vocabulary. */
const IMAGERY_SYNONYMS: Record<string, string[]> = {
  'night-sky': ['space', 'stars', 'nebula'],
  stars: ['stars', 'space', 'particles'],
  prayer: ['light-rays', 'glow'],
  flag: ['ribbons', 'waveform'],
  embers: ['fire', 'particles', 'plasma'],
  fire: ['fire', 'plasma'],
  sparks: ['fire', 'particles'],
  gunmetal: ['geometric', 'grid', 'tunnel'],
  sirens: ['lightning', 'light-rays'],
  rain: ['rain', 'water', 'particles'],
  tears: ['water', 'rain', 'liquid'],
  storm: ['storm', 'lightning', 'smoke'],
  streetlights: ['city', 'light-rays', 'glow'],
  'city-night': ['city', 'grid', 'tunnel'],
  smoke: ['smoke', 'fog', 'liquid'],
  fog: ['fog', 'smoke'],
  haze: ['fog', 'smoke', 'glow'],
  fluorescent: ['grid', 'glass', 'geometric'],
  ocean: ['ocean', 'water', 'liquid'],
  crystal: ['crystal', 'glass'],
}

export interface ScoreTarget {
  axes: MoodAxes
  energy: number
  palette: Rgb[]
  imagery: string[]
  /** Version 3 sections: the tags are free text and also match by word. */
  freeText?: boolean
}

/**
 * The catalog tags a section's imagery asks for. A known tag goes
 * through the synonym table; a free-text tag (version 3) that the table
 * does not know is also tried word by word, plural or not.
 */
function wantedTags(imagery: readonly string[], freeText: boolean): Set<string> {
  const wanted = new Set<string>()
  for (const raw of imagery) {
    const tag = raw.toLowerCase()
    if (Object.hasOwn(IMAGERY_SYNONYMS, tag) || !freeText) {
      for (const mapped of IMAGERY_SYNONYMS[tag] ?? [tag]) wanted.add(mapped)
      continue
    }
    wanted.add(tag)
    for (const word of tag.split(/[^a-z]+/)) {
      if (word === '') continue
      for (const form of new Set([word, `${word}s`, word.replace(/s$/, '')])) {
        if (Object.hasOwn(IMAGERY_SYNONYMS, form)) {
          for (const mapped of IMAGERY_SYNONYMS[form]) wanted.add(mapped)
        } else {
          wanted.add(form)
        }
      }
    }
  }
  return wanted
}

export function targetForSection(section: SemanticSection | null): ScoreTarget {
  const palette: Rgb[] = (section?.palette ?? []).slice(1).map((hex) => {
    const n = parseInt(hex.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  })
  return {
    axes: sectionAxes(section),
    energy: section?.energy ?? 0.5,
    palette,
    imagery: section?.imagery ?? [],
    ...(section?.axes !== undefined ? { freeText: true } : {}),
  }
}

function colorDistance(a: Rgb, b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 441.7
}

export interface Scored {
  name: string
  score: number
  /** Top contributors, best first, e.g. "axes 0.84". */
  reasons: string[]
}

export function scorePreset(
  name: string,
  target: ScoreTarget,
  catalog: Record<string, CatalogEntry> = CATALOG,
): Scored {
  const entry = catalog[name]
  const W = PRESET_SCORE

  const axisDiff =
    (Math.abs(entry.axes.arousal - target.axes.arousal) +
      Math.abs(entry.axes.valence - target.axes.valence) +
      Math.abs(entry.axes.tension - target.axes.tension) +
      Math.abs(entry.axes.warmth - target.axes.warmth)) /
    4
  const axes = 1 - axisDiff

  const motionNorm = Math.min(1, entry.motion * 10)
  const energy =
    1 - Math.abs(target.energy - (0.6 * entry.axes.arousal + 0.4 * motionNorm))

  let palette = 0.5
  if (target.palette.length > 0) {
    let best = 1
    for (const want of target.palette) {
      for (const have of entry.colors) {
        best = Math.min(best, colorDistance(want, have))
      }
    }
    palette = 1 - best
  }

  const wanted = wantedTags(target.imagery, target.freeText === true)
  const hits = entry.imagery.filter((tag) => wanted.has(tag)).length
  const imagery = wanted.size === 0 ? 0.5 : Math.min(1, hits / Math.min(2, wanted.size))

  const readability = entry.readability
  const quality = (entry.quality - 1) / 4

  const parts: [string, number, number][] = [
    ['axes', axes, W.axes],
    ['energy', energy, W.energy],
    ['palette', palette, W.palette],
    ['imagery', imagery, W.imagery],
    ['readable', readability, W.readability],
    ['quality', quality, W.quality],
  ]
  const totalWeight = parts.reduce((a, [, , weight]) => a + weight, 0)
  let score = parts.reduce((a, [, value, weight]) => a + value * weight, 0) / totalWeight
  if (entry.flags.includes('slow')) score *= W.slowPenalty

  const reasons = [...parts]
    .sort((a, b) => b[1] * b[2] - a[1] * a[2])
    .slice(0, 3)
    .map(([label, value]) => `${label} ${value.toFixed(2)}`)
  return { name, score, reasons }
}

/** Ranked usable candidates for a section, best first. Deterministic. */
export function rankForSection(
  section: SemanticSection | null,
  feedback: Feedback,
  limit: number = PRESET_SCORE.candidates,
  catalog: Record<string, CatalogEntry> = CATALOG,
): Scored[] {
  const target = targetForSection(section)
  return Object.keys(catalog)
    .sort()
    .filter((name) => isUsable(name, feedback, catalog))
    .map((name) => scorePreset(name, target, catalog))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
}

export interface LabelPick {
  label: string
  /**
   * What ] [ cycles through: the look's pick first (when it can play),
   * then the scorer's ranked list.
   */
  candidates: Scored[]
  chosen: string | null
  /** Who decided: the owner's saved choice, the song's look, or the scorer. */
  source: 'saved' | 'look' | 'scorer'
  /** True when the owner picked it with ] [. */
  fromFeedback: boolean
  reasons: string[]
  runnerUp: string | null
}

/**
 * Assign one preset per section label, in order of first appearance.
 * The owner's saved choice wins; then the look's preset for the label,
 * when it is usable and no chronological neighbour already plays it;
 * then the scorer, skipping any preset already assigned to a
 * chronologically neighbouring section.
 */
export function pickForSections(
  sections: SemanticSection[],
  feedback: Feedback,
  catalog: Record<string, CatalogEntry> = CATALOG,
  look: SongLook | null = null,
): Map<string, LabelPick> {
  const byLabel = new Map<string, LabelPick>()
  const assigned = new Map<string, string>() // label -> preset
  for (let i = 0; i < sections.length; i++) {
    const label = sections[i].label
    if (byLabel.has(label)) continue
    const target = targetForSection(sections[i])
    let candidates = rankForSection(sections[i], feedback, PRESET_SCORE.candidates, catalog)
    const lookName =
      look && Object.hasOwn(look.presets, label) && isUsable(look.presets[label], feedback, catalog)
        ? look.presets[label]
        : null
    if (lookName !== null) {
      candidates = [
        scorePreset(lookName, target, catalog),
        ...candidates.filter((c) => c.name !== lookName),
      ]
    }
    const neighbours = new Set<string>()
    sections.forEach((section, j) => {
      if (section.label !== label) return
      for (const k of [j - 1, j + 1]) {
        const neighbourLabel = sections[k]?.label
        if (neighbourLabel && neighbourLabel !== label) {
          const preset = assigned.get(neighbourLabel)
          if (preset) neighbours.add(preset)
        }
      }
    })
    const saved = feedback.chosen[label]
    let chosen: Scored | null = null
    let source: LabelPick['source'] = 'scorer'
    if (saved && isUsable(saved, feedback, catalog)) {
      chosen = candidates.find((c) => c.name === saved) ?? scorePreset(saved, target, catalog)
      source = 'saved'
    } else if (lookName !== null && !neighbours.has(lookName)) {
      chosen = candidates[0]
      source = 'look'
    } else {
      chosen = candidates.find((c) => !neighbours.has(c.name)) ?? candidates[0] ?? null
    }
    if (chosen) assigned.set(label, chosen.name)
    const runnerUp = candidates.find((c) => c.name !== chosen?.name) ?? null
    byLabel.set(label, {
      label,
      candidates,
      chosen: chosen?.name ?? null,
      source,
      fromFeedback: source === 'saved',
      reasons: chosen?.reasons ?? [],
      runnerUp: runnerUp?.name ?? null,
    })
  }
  return byLabel
}
