/**
 * Merge catalog-strips/measurements.json with the subagent tag batches
 * (catalog-strips/tags/batch-*.json) into src/presetCatalog.json.
 * Validates every entry, computes cross-batch agreement on the control
 * presets, and reports what was flagged.
 */

import fs from 'node:fs'

const VOCAB = new Set(
  'fire plasma water ocean rain liquid smoke fog space stars nebula tunnel city grid geometric crystal glass organic flower light-rays glow lightning storm spiral waveform particles ribbons'.split(
    ' ',
  ),
)
const AXES = ['arousal', 'valence', 'tension', 'warmth']

const measurements = JSON.parse(fs.readFileSync('catalog-strips/measurements.json', 'utf8'))
const tagFiles = fs.existsSync('catalog-strips/tags')
  ? fs.readdirSync('catalog-strips/tags').filter((f) => f.endsWith('.json')).sort()
  : []

const tags = {}
const controlSamples = {} // name -> [{batch, axes}]
const problems = []

for (const file of tagFiles) {
  let batch
  try {
    batch = JSON.parse(fs.readFileSync(`catalog-strips/tags/${file}`, 'utf8'))
  } catch (error) {
    problems.push(`${file}: unparseable (${String(error).slice(0, 80)})`)
    continue
  }
  for (const [name, tag] of Object.entries(batch)) {
    if (!measurements[name]) {
      problems.push(`${file}: unknown preset "${name}"`)
      continue
    }
    const bad = []
    if (typeof tag.description !== 'string' || tag.description.length < 10) bad.push('description')
    for (const axis of AXES) {
      const v = tag.axes?.[axis]
      if (typeof v !== 'number' || v < 0 || v > 1) bad.push(`axes.${axis}`)
    }
    if (
      !Array.isArray(tag.imagery) ||
      tag.imagery.length < 1 ||
      tag.imagery.length > 4 ||
      tag.imagery.some((t) => !VOCAB.has(t))
    )
      bad.push(`imagery [${(tag.imagery ?? []).join(',')}]`)
    if (!Number.isInteger(tag.quality) || tag.quality < 1 || tag.quality > 5) bad.push('quality')
    if (bad.length > 0) {
      problems.push(`${file}: "${name}" invalid: ${bad.join(', ')}`)
      continue
    }
    // Control presets appear in several batches: keep every sample.
    if (tags[name]) {
      ;(controlSamples[name] ??= []).push({ batch: file, axes: tag.axes })
    } else {
      tags[name] = tag
      // Seed with the first sample too, in case it is a control.
      ;(controlSamples[name] ??= []).push({ batch: file, axes: tag.axes })
    }
  }
}

// Control agreement: mean abs deviation from the per-axis median.
const controls = {}
for (const [name, samples] of Object.entries(controlSamples)) {
  if (samples.length < 3) continue
  const spread = {}
  for (const axis of AXES) {
    const values = samples.map((s) => s.axes[axis]).sort((a, b) => a - b)
    const median = values[Math.floor(values.length / 2)]
    spread[axis] = Number(
      (values.reduce((a, v) => a + Math.abs(v - median), 0) / values.length).toFixed(3),
    )
  }
  controls[name] = { batches: samples.length, mad: spread }
}

const presets = {}
let untagged = 0
for (const [name, m] of Object.entries(measurements)) {
  const tag = tags[name]
  if (!tag) {
    untagged++
    if (!m.flags?.includes('error')) problems.push(`untagged: "${name}"`)
  }
  presets[name] = {
    ...m,
    description: tag?.description ?? '(untagged)',
    axes: tag?.axes ?? { arousal: 0.5, valence: 0.5, tension: 0.5, warmth: 0.5 },
    imagery: tag?.imagery ?? [],
    quality: tag?.quality ?? 1,
  }
  if (!tag && !presets[name].flags.includes('error')) {
    presets[name].flags = [...presets[name].flags, 'untagged']
  }
}

const out = {
  _meta: {
    capturedAt: new Date().toISOString().slice(0, 10),
    track: 'scripted: quiet 2-3.2s, loud, beats at 5.5-7.0s (see src/catalogRunner.ts)',
    rubric: 'scripts/tagging-rubric.md',
    controls,
  },
  presets,
}
fs.writeFileSync('src/presetCatalog.json', JSON.stringify(out, null, 1) + '\n')

const flagCounts = {}
for (const p of Object.values(presets)) {
  for (const f of p.flags ?? []) flagCounts[f] = (flagCounts[f] ?? 0) + 1
}
console.log(
  `merged ${Object.keys(presets).length} presets (${untagged} untagged) · flags:`,
  flagCounts,
)
console.log('controls:', JSON.stringify(controls, null, 1))
if (problems.length > 0) {
  console.log(`\n${problems.length} problems:`)
  for (const p of problems.slice(0, 40)) console.log(' -', p)
  process.exitCode = 1
}
