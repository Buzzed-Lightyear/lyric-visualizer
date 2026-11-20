/**
 * npm run look-sheets [-- --song <slug>] [--out <dir>]
 *
 * One contact sheet per song under review/ (<slug>.jpg): the look
 * description, the palette swatches, the two type voices set in their
 * real faces, and for every section label the four frames of the preset
 * it plays (quiet, loud, on a beat, later) with its mood, axes and
 * scene.
 *
 * Each frame carries the song title, drawn by the real text layer with
 * its readability treatment (the dev harness page does the drawing, so
 * this script starts the dev server), and the scene's measured contrast
 * is printed beside it: the share of samples at 3:1 or better and the
 * median ratio, for adaptive text and for the old scrim.
 *
 * The frames come from `npm run catalog` (catalog-strips/, gitignored)
 * when the strip is on disk, and are rendered on the spot otherwise.
 * The sheets carry no lyric text — everything on them is in the
 * committed files.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { sectionAxes } from '../src/axes'
import type { SceneReadability, SongReadability } from '../src/legibilityProbe'
import { formatTime, parseMeta } from '../src/library'
import { sectionsByLabel } from '../src/lookGen'
import { sectionGrammar } from '../src/mapping'
import { CATALOG, feedbackFor, parseFeedbackFile, pickForSections } from '../src/presetPick'
import { parseSemantics } from '../src/semantics'
import { VOICE_DESCRIPTIONS, VOICES, type VoiceName } from '../src/voiceNames'

const SONGS = path.resolve('public/songs')
const STRIPS = path.resolve('catalog-strips')

const args = process.argv.slice(2)
const argValue = (name: string): string | null => {
  const i = args.indexOf(name)
  return i >= 0 ? (args[i + 1] ?? null) : null
}
const only = argValue('--song')
const outDir = path.resolve(argValue('--out') ?? 'review')

/** The faces voices.ts loads, as stylesheets Chromium can read from disk. */
const FONT_CSS = [
  '@fontsource/archivo-black/index.css',
  '@fontsource/inter/300.css',
  '@fontsource/inter/400.css',
  '@fontsource/anton/index.css',
  '@fontsource/playfair-display/700.css',
  '@fontsource/cormorant-garamond/500-italic.css',
  '@fontsource/space-mono/index.css',
  '@fontsource/permanent-marker/index.css',
  '@fontsource/alfa-slab-one/index.css',
].map((file) => pathToFileURL(path.resolve('node_modules', file)).href)

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
  } catch {
    return null
  }
}

function voiceStyle(name: VoiceName, sizePx: number): string {
  const voice = VOICES[name]
  return (
    `font-family:${voice.family.replace(/"/g, "'")},sans-serif;font-weight:${voice.weight};` +
    `font-style:${voice.italic ? 'italic' : 'normal'};letter-spacing:${voice.tracking}em;` +
    `text-transform:${voice.caps ? 'uppercase' : 'none'};font-size:${sizePx}px`
  )
}

const swatch = (color: string, label = true) =>
  `<span class="sw"><i style="background:${color}"></i>${label ? `<b>${color}</b>` : ''}</span>`

function strip(name: string): string {
  const entry = CATALOG[name]
  const file = entry ? path.join(STRIPS, `${entry.slug}.png`) : null
  if (!file || !fs.existsSync(file)) {
    return `<div class="missing">no strip on disk for this preset — run <code>npm run catalog</code></div>`
  }
  return `<img src="${pathToFileURL(file).href}" alt="">`
}

const percent = (share: number) => `${(share * 100).toFixed(1)}%`

/** The four frames with the title drawn over them, and the measured contrast. */
function sceneBlock(scene: SceneReadability): string {
  const frames = (scene.images ?? [])
    .map((src) => `<img src="${src}" alt="">`)
    .join('')
  const ok = scene.after.pass >= 0.95
  return (
    `<div class="frames">${frames}</div>` +
    `<div class="contrast"><span class="${ok ? 'ok' : 'bad'}">adaptive text: ${percent(scene.after.pass)} of samples at 3:1 or better, ` +
    `median ${scene.after.median.toFixed(1)}:1</span>` +
    ` · ${scene.polarity ?? 'no'} text · backing ${scene.strength.map((s) => s.toFixed(2)).join(' / ')}` +
    ` · accent ${scene.accent ? 'on' : 'off'}` +
    `<span class="old"> · old scrim: ${percent(scene.before.pass)}, median ${scene.before.median.toFixed(1)}:1</span>` +
    (scene.frames === 'rendered' ? ' · frames rendered now (no strip on disk)' : '') +
    `</div>`
  )
}

function sheetHtml(slug: string, readability: SongReadability | null): string | null {
  const { meta } = parseMeta(readJson(path.join(SONGS, slug, 'meta.json')))
  const { semantics } = parseSemantics(readJson(path.join(SONGS, slug, 'semantics.json')))
  if (!meta || !semantics) return null
  const feedbackFile = parseFeedbackFile(readJson(path.resolve('src/presetFeedback.json')))
  const feedback = feedbackFor(feedbackFile, slug)
  const look = semantics.look ?? null
  const automatic = pickForSections(semantics.sections, { chosen: {}, banned: feedback.banned }, CATALOG, look)
  const played = pickForSections(semantics.sections, feedback, CATALOG, look)
  const duration = semantics.sections[semantics.sections.length - 1].end

  const lookState = !look
    ? 'no look (version 2 file): presets by the scorer, voices by mood word'
    : `look ${look.partial ? 'PARTIAL (written without lyrics; sections are still version 2)' : 'full (version 3)'}` +
      ` · written by ${look.source ?? 'unknown'} · presets chosen by the ${look.presetsFrom ?? 'model'}` +
      (look.review
        ? look.review.ran
          ? ` · reviewed against the strips: ${look.review.swapped.length} swapped`
          : ' · strip review did not run'
        : '')

  const voices = look
    ? (['main', 'accent'] as const)
        .map((role) => {
          const name = look.voices[role]
          return (
            `<div class="voice"><span class="role">${role}</span>` +
            `<span class="sample" style="${voiceStyle(name, 40)}">${esc(role === 'main' ? meta.title : meta.artist)}</span>` +
            `<span class="vname">${name} — ${esc(VOICE_DESCRIPTIONS[name])}</span></div>`
          )
        })
        .join('')
    : '<div class="note">voices follow each section\'s mood word</div>'

  const timeline = semantics.sections
    .map((section) => {
      const width = ((section.end - section.start) / duration) * 100
      const color = section.palette[1] ?? section.palette[0]
      return `<span style="width:${width.toFixed(3)}%;background:${color}"><em>${esc(section.label)}</em></span>`
    })
    .join('')

  const rows = sectionsByLabel(semantics.sections)
    .map((section) => {
      const pick = automatic.get(section.label)
      const saved = played.get(section.label)
      const axes = sectionAxes(section)
      const grammar = sectionGrammar(section, look)
      const spans = semantics.sections
        .filter((other) => other.label === section.label)
        .map((other) => `${formatTime(other.start)}–${formatTime(other.end)}`)
        .join(', ')
      const facts = [
        `energy ${section.energy.toFixed(2)}`,
        `mood “${esc(section.mood)}”`,
        `axes a ${axes.arousal.toFixed(2)} · v ${axes.valence.toFixed(2)} · t ${axes.tension.toFixed(2)} · w ${axes.warmth.toFixed(2)}`,
        `imagery ${section.imagery.length > 0 ? esc(section.imagery.join(', ')) : '—'}`,
        `voice ${grammar.voice}${section.voice ? ` (${section.voice})` : ''} · hold ${grammar.hold} · anchor ${grammar.anchor} · in ${grammar.entrance}`,
      ]
      const chosen = pick?.chosen ?? null
      const entry = chosen ? CATALOG[chosen] : undefined
      const measured = readability?.scenes.find(
        (scene) => scene.label === section.label && scene.images?.length,
      )
      const swapped = look?.review?.swapped.includes(section.label) ?? false
      const override =
        saved && saved.source === 'saved' && saved.chosen && saved.chosen !== chosen
          ? `<div class="preset saved"><div class="pname"><span class="tag">your saved choice — plays instead</span> ${esc(saved.chosen)}</div>` +
            `<div class="pdesc">${esc(CATALOG[saved.chosen]?.description ?? '')}</div>${strip(saved.chosen)}</div>`
          : saved && saved.source === 'saved' && saved.chosen === chosen
            ? '<div class="note">your saved choice is the same preset</div>'
            : ''
      return (
        `<section><div class="meta"><h3>${esc(section.label)}</h3><div class="spans">${spans}</div>` +
        `<div class="chips">${section.palette.map((color) => swatch(color, false)).join('')}</div>` +
        `<ul>${facts.map((fact) => `<li>${fact}</li>`).join('')}</ul>` +
        (section.scene ? `<p class="scene">${esc(section.scene)}</p>` : '') +
        `</div><div class="presets">` +
        (chosen
          ? `<div class="preset"><div class="pname"><span class="tag">${pick!.source === 'look' ? 'look' : pick!.source === 'saved' ? 'kept' : 'scorer'}</span>` +
            `${swapped ? '<span class="tag swap">swapped in review</span>' : ''} ${esc(chosen)}</div>` +
            `<div class="pdesc">${esc(entry?.description ?? '')}</div>` +
            `${measured && measured.preset === (saved?.chosen ?? chosen) ? sceneBlock(measured) : strip(chosen)}</div>`
          : '<div class="missing">no usable preset</div>') +
        override +
        `</div></section>`
      )
    })
    .join('')

  return `<!doctype html><html><head><meta charset="utf-8">
${FONT_CSS.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n')}
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #0c0d11; color: #d8dbe3; font: 400 14px/1.45 Inter, system-ui, sans-serif; width: 1500px; }
  main { padding: 36px 40px 40px; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 24px; }
  h1 { margin: 0; font: 400 30px/1.2 Inter, sans-serif; color: #fff; }
  h1 small { font-size: 18px; color: #9aa0ae; margin-left: 10px; }
  .slug { color: #7d8392; font: 12px 'Space Mono', monospace; text-align: right; }
  .state { color: #9aa0ae; font-size: 12px; margin-top: 4px; }
  .desc { font-size: 21px; line-height: 1.4; color: #f1f2f6; margin: 22px 0 20px; max-width: 1180px; }
  .desc.none { color: #7d8392; font-size: 16px; }
  .look { display: grid; grid-template-columns: 520px 1fr; gap: 36px; align-items: start; margin-bottom: 22px; }
  .label { text-transform: uppercase; letter-spacing: .12em; font-size: 11px; color: #7d8392; margin-bottom: 8px; }
  .sw { display: inline-flex; flex-direction: column; align-items: center; margin-right: 8px; }
  .sw i { display: block; width: 68px; height: 68px; border-radius: 6px; border: 1px solid #ffffff22; }
  .sw b { font: 11px 'Space Mono', monospace; color: #9aa0ae; margin-top: 5px; font-weight: 400; }
  .voice { display: grid; grid-template-columns: 62px 1fr; column-gap: 12px; align-items: baseline; margin-bottom: 10px; }
  .voice .role { text-transform: uppercase; letter-spacing: .12em; font-size: 11px; color: #7d8392; }
  .voice .sample { color: #fff; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .voice .vname { grid-column: 2; color: #9aa0ae; font-size: 12px; }
  .timeline { display: flex; height: 30px; border-radius: 5px; overflow: hidden; margin: 6px 0 26px; }
  .timeline span { display: flex; align-items: center; justify-content: center; overflow: hidden; border-right: 2px solid #0c0d11; }
  .timeline em { font: 11px 'Space Mono', monospace; font-style: normal; color: #0c0d11; background: #ffffffb0; padding: 0 5px; border-radius: 3px; white-space: nowrap; }
  section { display: grid; grid-template-columns: 330px 1fr; gap: 26px; padding: 18px 0; border-top: 1px solid #ffffff18; }
  h3 { margin: 0; font: 400 20px/1.2 Inter, sans-serif; color: #fff; }
  .spans { color: #7d8392; font: 11px 'Space Mono', monospace; margin: 3px 0 8px; }
  .chips .sw i { width: 30px; height: 18px; border-radius: 3px; }
  .chips .sw { margin-right: 4px; }
  ul { list-style: none; padding: 0; margin: 8px 0 0; color: #b3b8c4; font-size: 12.5px; }
  .scene { color: #e6e8ee; font-size: 14px; margin: 8px 0 0; font-style: italic; }
  .preset { margin-bottom: 12px; }
  .preset img { display: block; width: 100%; border-radius: 5px; margin-top: 6px; }
  .preset.saved img { width: 66%; opacity: .92; }
  .frames { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; margin-top: 6px; border-radius: 5px; overflow: hidden; }
  .frames img { margin: 0; border-radius: 0; }
  .contrast { font: 11.5px 'Space Mono', monospace; color: #b3b8c4; margin-top: 6px; }
  .contrast .ok { color: #8fd6a4; }
  .contrast .bad { color: #ff9a8a; }
  .contrast .old { color: #7d8392; }
  .tag.swap { background: #1f3a2a; color: #9fe0b4; }
  .pname { font: 12px 'Space Mono', monospace; color: #e6e8ee; }
  .pdesc { color: #9aa0ae; font-size: 12.5px; margin-top: 2px; }
  .tag { display: inline-block; background: #2a2e3a; color: #c8ccd6; border-radius: 3px; padding: 0 6px; margin-right: 6px; }
  .saved .tag { background: #4a3a14; color: #f0d28a; }
  .note, .missing { color: #7d8392; font-size: 12px; }
  .missing { border: 1px dashed #ffffff30; border-radius: 5px; padding: 18px; }
  footer { color: #5f6573; font-size: 11px; margin-top: 14px; border-top: 1px solid #ffffff18; padding-top: 10px; }
</style></head><body><main>
<header><h1>${esc(meta.title)}<small>${esc(meta.artist)}</small></h1><div class="slug">${esc(slug)}</div></header>
<div class="state">${esc(lookState)} · ${formatTime(meta.duration)}</div>
<p class="desc${look ? '' : ' none'}">${look ? esc(look.description) : 'This song has no look yet.'}</p>
<div class="look">
  <div><div class="label">song palette</div>${(look?.palette ?? []).map((color) => swatch(color)).join('') || '<div class="note">—</div>'}</div>
  <div><div class="label">type voices (title in main, artist in accent)</div>${voices}</div>
</div>
<div class="label">sections</div>
<div class="timeline">${timeline}</div>
${rows}
<footer>Frames, left to right: quiet · loud · on a beat · later (the scripted test track of npm run catalog). The title on each frame is drawn by the real text layer: it enters over the first frame and is held while the background changes. Contrast is measured between glyph pixels and their immediate surround, backing included. Generated by npm run look-sheets from the committed semantics; no lyric text.</footer>
</main></body></html>`
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch()
  } catch {
    return await chromium.launch({ channel: 'chrome' })
  }
}

const PORT = 5184
const BASE = `http://localhost:${PORT}`

async function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`dev server did not come up at ${url}`)
}

const slugs = fs
  .readdirSync(SONGS)
  .filter((name) => fs.statSync(path.join(SONGS, name)).isDirectory())
  .filter((name) => !only || name === only)
  .sort()
if (slugs.length === 0) {
  console.error(only ? `look-sheets: no song "${only}"` : 'look-sheets: no songs under public/songs/')
  process.exit(1)
}

fs.mkdirSync(outDir, { recursive: true })
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'look-sheets-'))
// The harness page draws the title over each frame with the real text layer.
// One process (node running Vite's own entry), so killing it really stops the server.
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore' },
)
let browser: Browser | null = null
let exitCode = 0
try {
  await waitForServer(`${BASE}/harness.html`)
  browser = await launchBrowser()
  const harness = await browser.newPage({ viewport: { width: 1000, height: 600 } })
  await harness.goto(`${BASE}/harness.html`)
  await harness.waitForFunction(() => window.__ready === true, null, { timeout: 60000 })
  // 2x so the type stays crisp when the sheet is zoomed; JPEG keeps the
  // frames (photographic content) small enough to commit.
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 })
  for (const slug of slugs) {
    const readability = (await harness.evaluate(
      (name) => window.__harness.readabilityOf(name),
      slug,
    )) as SongReadability | null
    const html = sheetHtml(slug, readability)
    if (!html) {
      console.warn(`  skipping ${slug}: no readable meta.json + semantics.json`)
      continue
    }
    const file = path.join(tmp, `${slug}.html`)
    fs.writeFileSync(file, html)
    await page.goto(pathToFileURL(file).href)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForLoadState('networkidle')
    const target = path.join(outDir, `${slug}.jpg`)
    await page.screenshot({ path: target, fullPage: true, type: 'jpeg', quality: 80 })
    console.log(`  ${path.relative(process.cwd(), target)}`)
  }
} catch (error) {
  console.error('look-sheets failed:', error)
  exitCode = 1
} finally {
  if (browser) await browser.close()
  server.kill('SIGTERM')
  fs.rmSync(tmp, { recursive: true, force: true })
}
process.exit(exitCode)
