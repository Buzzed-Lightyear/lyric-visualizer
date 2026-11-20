/**
 * npm run catalog: render and measure every installed butterchurn preset
 * offline (injected audio + fixed clock; see src/catalogRunner.ts).
 * Writes catalog-strips/<slug>.png (4-frame strip: quiet, loud, beat,
 * later) and catalog-strips/measurements.json. Resumable: presets with
 * an entry and a strip are skipped. Flags: error, blank, strobe, and
 * (computed at the end, relative to the median) slow.
 *
 * Usage: node scripts/catalog.mjs [--limit N] [--concurrency N] [--only name]
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { chromium } from 'playwright'

const PORT = 5181
const BASE = `http://localhost:${PORT}`
const OUT = 'catalog-strips'
const MEASUREMENTS = `${OUT}/measurements.json`

const args = process.argv.slice(2)
const argValue = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const LIMIT = Number(argValue('--limit', Infinity))
const CONCURRENCY = Number(argValue('--concurrency', 4))
const ONLY = argValue('--only', null)

function slugify(name, taken) {
  let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  if (!slug) slug = 'preset'
  let candidate = slug
  let n = 2
  while (taken.has(candidate)) candidate = `${slug}-${n++}`
  taken.add(candidate)
  return candidate
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await wait(250)
  }
  throw new Error(`dev server did not come up at ${url}`)
}

const LAUNCH_ARGS = ['--autoplay-policy=no-user-gesture-required']

/** Playwright's bundled Chromium; installed Chrome when that one is missing. */
async function launchBrowser() {
  try {
    return await chromium.launch({ args: LAUNCH_ARGS })
  } catch {
    return await chromium.launch({ channel: 'chrome', args: LAUNCH_ARGS })
  }
}

fs.mkdirSync(OUT, { recursive: true })
const store = fs.existsSync(MEASUREMENTS)
  ? JSON.parse(fs.readFileSync(MEASUREMENTS, 'utf8'))
  : {}
const takenSlugs = new Set(Object.values(store).map((entry) => entry.slug))

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
})

let browser
let exitCode = 0
try {
  await waitForServer(`${BASE}/catalog.html`)
  browser = await launchBrowser()

  const makePage = async () => {
    const page = await browser.newPage({ viewport: { width: 500, height: 300 } })
    page.on('pageerror', (e) => console.error('page error:', String(e).slice(0, 200)))
    await page.goto(`${BASE}/catalog.html`)
    await page.waitForFunction(() => window.__catalogReady === true, null, { timeout: 60000 })
    return page
  }

  const first = await makePage()
  let names = await first.evaluate(() => window.__catalog.listPresets())
  if (ONLY) names = names.filter((n) => n.includes(ONLY))
  // Done = has a strip, or failed INSIDE the page (a real preset error).
  // Driver-side failures (crashed page) are retried.
  const todo = names
    .filter((name) => {
      const entry = store[name]
      if (!entry) return true
      if (fs.existsSync(`${OUT}/${entry.slug}.png`)) return false
      return !(entry.flags?.includes('error') && !String(entry.error ?? '').startsWith('driver:'))
    })
    .slice(0, LIMIT)
  console.log(`${names.length} presets, ${todo.length} to capture (${names.length - todo.length} already done)`)

  const pages = [first]
  for (let i = 1; i < Math.min(CONCURRENCY, Math.max(1, todo.length)); i++) pages.push(await makePage())

  let cursor = 0
  let done = 0
  const save = () => fs.writeFileSync(MEASUREMENTS, JSON.stringify(store, null, 1))
  // Long runs wear pages out (hundreds of shader compiles), so each
  // worker recycles its page periodically and recreates it on failure.
  const worker = async (page) => {
    let sinceRecycle = 0
    for (;;) {
      const index = cursor++
      if (index >= todo.length) break
      const name = todo[index]
      if (sinceRecycle >= 35) {
        await page.close().catch(() => {})
        page = await makePage()
        sinceRecycle = 0
      }
      let result = null
      for (let attempt = 0; attempt < 2 && !result; attempt++) {
        try {
          result = await page.evaluate(
            (presetName) => window.__catalog.capture(presetName),
            name,
          )
        } catch (error) {
          console.error(`retrying ${name.slice(0, 40)} on a fresh page (${String(error).slice(0, 80)})`)
          await page.close().catch(() => {})
          page = await makePage()
          sinceRecycle = 0
          if (attempt === 1) {
            store[name] = {
              slug: store[name]?.slug ?? slugify(name, takenSlugs),
              flags: ['error'],
              error: `driver: ${String(error).slice(0, 200)}`,
            }
          }
        }
      }
      if (result) {
        const slug = store[name]?.slug ?? slugify(name, takenSlugs)
        if (result.strip) {
          fs.writeFileSync(`${OUT}/${slug}.png`, Buffer.from(result.strip.split(',')[1], 'base64'))
        }
        store[name] = { slug, ...result.measurements }
      }
      sinceRecycle++
      done++
      if (done % 10 === 0 || done === todo.length) {
        save()
        console.log(`${done}/${todo.length}  (${name.slice(0, 44)})`)
      }
    }
    await page.close().catch(() => {})
  }
  await Promise.all(pages.map((page) => worker(page)))
  save()

  // Relative cost flag, over the medians of everything measured.
  const costs = Object.values(store)
    .map((entry) => entry.costMs)
    .filter((cost) => typeof cost === 'number' && cost > 0)
    .sort((a, b) => a - b)
  const median = costs[Math.floor(costs.length / 2)] ?? 1
  for (const entry of Object.values(store)) {
    if (!entry.flags) continue
    entry.flags = entry.flags.filter((flag) => flag !== 'slow')
    if (typeof entry.costMs === 'number' && entry.costMs > median * 4) entry.flags.push('slow')
  }
  save()

  const flagged = {}
  for (const entry of Object.values(store)) {
    for (const flag of entry.flags ?? []) flagged[flag] = (flagged[flag] ?? 0) + 1
  }
  console.log(`captured ${Object.keys(store).length}/${names.length} · median cost ${median.toFixed(2)}ms · flags:`, flagged)
} catch (error) {
  console.error('catalog failed:', error)
  exitCode = 1
} finally {
  if (browser) await browser.close()
  server.kill('SIGTERM')
}
process.exit(exitCode)
