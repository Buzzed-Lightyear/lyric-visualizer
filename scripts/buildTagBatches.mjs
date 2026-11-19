/**
 * Split the captured presets into tag batches for the subagents. Each
 * batch file carries ~20 presets (name, absolute strip path, measured
 * numbers), the two control presets (every batch, unmarked), and the
 * six hand-tagged anchors as worked examples.
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve('.')
const measurements = JSON.parse(fs.readFileSync('catalog-strips/measurements.json', 'utf8'))

const ANCHORS = {
  'Rovastar - Hyperspace': {
    description:
      'A rush of cyan light streaks and particles exploding outward from a dark center, like jumping to hyperspace.',
    axes: { arousal: 0.85, valence: 0.55, tension: 0.6, warmth: 0.3 },
    imagery: ['space', 'particles', 'light-rays', 'tunnel'],
    quality: 4,
  },
  'Flexi - crush ice 72': {
    description:
      'Bright icy white and blue marbled streaks flowing toward a vanishing point like frost rivers.',
    axes: { arousal: 0.5, valence: 0.8, tension: 0.35, warmth: 0.15 },
    imagery: ['water', 'crystal', 'liquid'],
    quality: 4,
  },
  'Stahlregen & Boz + Eo.S + Geiss + Phat + Rovastar + Zylot - Machine Code [Jelly]': {
    description: 'Neon-edged rectangles scrolling like glowing circuit traces on black.',
    axes: { arousal: 0.6, valence: 0.45, tension: 0.7, warmth: 0.35 },
    imagery: ['grid', 'geometric', 'city'],
    quality: 4,
  },
  '$$$ Royal - Mashup (326)': {
    description: 'An almost black screen with faint dark concentric rings that barely move.',
    axes: { arousal: 0.1, valence: 0.15, tension: 0.25, warmth: 0.3 },
    imagery: ['glow', 'spiral'],
    quality: 1,
  },
  'Cope - The Neverending Explosion of Red Liquid Fire': {
    description: 'A boiling dome of red liquid fire fringed in blue, churning and seething.',
    axes: { arousal: 0.75, valence: 0.25, tension: 0.65, warmth: 0.9 },
    imagery: ['fire', 'liquid', 'plasma'],
    quality: 4,
  },
  '$$$ Royal - Mashup (160)': {
    description:
      'A spinning kaleidoscope wheel with green, blue and red spokes radiating from the center.',
    axes: { arousal: 0.7, valence: 0.5, tension: 0.55, warmth: 0.45 },
    imagery: ['geometric', 'crystal', 'spiral'],
    quality: 3,
  },
}

const CONTROLS = [
  'Geiss - Reaction Diffusion 2',
  'Eo.S. + Zylot - skylight (Stained Glass Majesty mix)',
]

const BATCH_SIZE = 20

const entry = (name) => ({
  name,
  strip: path.join(ROOT, 'catalog-strips', `${measurements[name].slug}.png`),
  measurements: Object.fromEntries(
    Object.entries(measurements[name]).filter(([key]) => !['slug', 'error'].includes(key)),
  ),
})

const anchorBlock = Object.keys(ANCHORS).map((name) => ({
  ...entry(name),
  tags: ANCHORS[name],
}))

const names = Object.keys(measurements)
  .filter((name) => !ANCHORS[name] && !CONTROLS.includes(name))
  .sort()

fs.mkdirSync('catalog-strips/batches', { recursive: true })
fs.mkdirSync('catalog-strips/tags', { recursive: true })

let batchCount = 0
for (let i = 0; i < names.length; i += BATCH_SIZE) {
  const id = String(batchCount + 1).padStart(2, '0')
  const presets = [...names.slice(i, i + BATCH_SIZE).map(entry), ...CONTROLS.map(entry)]
  fs.writeFileSync(
    `catalog-strips/batches/batch-${id}.json`,
    JSON.stringify(
      {
        batch: id,
        output: path.join(ROOT, 'catalog-strips', 'tags', `batch-${id}.json`),
        anchors: anchorBlock,
        presets,
      },
      null,
      1,
    ),
  )
  batchCount++
}

// The anchors' own tags go straight into the merge as a batch.
const anchorTags = {}
for (const [name, tags] of Object.entries(ANCHORS)) anchorTags[name] = tags
fs.writeFileSync('catalog-strips/tags/batch-00-anchors.json', JSON.stringify(anchorTags, null, 1))

console.log(`${batchCount} batches of <= ${BATCH_SIZE} + ${CONTROLS.length} controls; ${names.length} presets + ${Object.keys(ANCHORS).length} anchors + ${CONTROLS.length} controls = ${names.length + 8}`)
