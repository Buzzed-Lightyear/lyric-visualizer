/**
 * Semantic preset picking: scores every usable catalog preset against a
 * section (mood axes, energy, palette, imagery, readability, quality)
 * and assigns one per section label. Rules: banned, broken, blank and
 * hard-strobing presets never play; sections with the same label share
 * one preset; neighbouring sections never share one; same inputs give
 * the same picks. Replaces the old title-based guesses.
 */

import { moodAxes, type MoodAxes, type Rgb } from './mapping'
import catalogJson from './presetCatalog.json'
import type { SemanticSection } from './semantics'
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
}

export function targetForSection(section: SemanticSection | null): ScoreTarget {
  const palette: Rgb[] = (section?.palette ?? []).slice(1).map((hex) => {
    const n = parseInt(hex.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  })
  return {
    axes: moodAxes(section?.mood ?? null),
    energy: section?.energy ?? 0.5,
    palette,
    imagery: section?.imagery ?? [],
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

  const wanted = new Set(
    target.imagery.flatMap((tag) => IMAGERY_SYNONYMS[tag.toLowerCase()] ?? [tag.toLowerCase()]),
  )
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
  candidates: Scored[]
  chosen: string | null
  /** True when the owner picked it with ] [. */
  fromFeedback: boolean
  reasons: string[]
  runnerUp: string | null
}

/**
 * Assign one preset per section label, in order of first appearance.
 * The owner's saved choice wins; automatic picks skip any preset already
 * assigned to a chronologically neighbouring section.
 */
export function pickForSections(
  sections: SemanticSection[],
  feedback: Feedback,
  catalog: Record<string, CatalogEntry> = CATALOG,
): Map<string, LabelPick> {
  const byLabel = new Map<string, LabelPick>()
  const assigned = new Map<string, string>() // label -> preset
  for (let i = 0; i < sections.length; i++) {
    const label = sections[i].label
    if (byLabel.has(label)) continue
    const candidates = rankForSection(sections[i], feedback, PRESET_SCORE.candidates, catalog)
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
    let fromFeedback = false
    if (saved && isUsable(saved, feedback, catalog)) {
      chosen = candidates.find((c) => c.name === saved) ?? scorePreset(saved, targetForSection(sections[i]), catalog)
      fromFeedback = true
    } else {
      chosen = candidates.find((c) => !neighbours.has(c.name)) ?? candidates[0] ?? null
    }
    if (chosen) assigned.set(label, chosen.name)
    const runnerUp = candidates.find((c) => c.name !== chosen?.name) ?? null
    byLabel.set(label, {
      label,
      candidates,
      chosen: chosen?.name ?? null,
      fromFeedback,
      reasons: chosen?.reasons ?? [],
      runnerUp: runnerUp?.name ?? null,
    })
  }
  return byLabel
}
