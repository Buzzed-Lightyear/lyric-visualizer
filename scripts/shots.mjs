/**
 * npm run shots: drive the visual harness headlessly, write
 * shots/contact-sheet.png and shots/report.json, and fail on the checks
 * defined in src/thresholds.ts.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { chromium } from 'playwright'
import { makeFixture } from './makeFixture.mjs'

// The made-up fixture songs: the harness falls back to them with an empty
// library, and the app smoke test runs the picker and transport on them.
makeFixture()

const PORT = 5178
const BASE = `http://localhost:${PORT}`

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServer(url, timeoutMs = 20000) {
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

async function launchBrowser() {
  try {
    // Prefer installed Chrome when available.
    return await chromium.launch({ channel: 'chrome', args: LAUNCH_ARGS })
  } catch {
    return await chromium.launch({ args: LAUNCH_ARGS })
  }
}

// Started as one process (node running Vite's own entry), not through npx:
// killing an npx wrapper can leave the real server running on the port,
// and the next run would then quietly talk to that stale one.
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)
let serverOutput = ''
server.stdout.on('data', (d) => (serverOutput += d))
server.stderr.on('data', (d) => (serverOutput += d))

let exitCode = 0
let browser
try {
  await waitForServer(`${BASE}/harness.html`)
  browser = await launchBrowser()
  const page = await browser.newPage({
    viewport: { width: 1400, height: 1000 },
    deviceScaleFactor: 1,
  })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text())
  })

  await page.goto(`${BASE}/harness.html`)
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 })
  const report = await page.evaluate(() => window.__harness.run(), null, { timeout: 0 })

  fs.mkdirSync('shots', { recursive: true })
  fs.writeFileSync('shots/report.json', JSON.stringify(report, null, 2))

  if (report.fatal) {
    console.error('harness could not run; semantics file problems:')
    for (const e of report.fatal) console.error('  -', e)
    exitCode = 1
  } else {
    // Export the sheet canvas directly: element screenshots race the
    // relayout after the harness resizes the canvas.
    const dataUrl = await page.evaluate(() =>
      document.getElementById('sheet').toDataURL('image/png'),
    )
    fs.writeFileSync('shots/contact-sheet.png', Buffer.from(dataUrl.split(',')[1], 'base64'))
    const failed = report.checks.filter((c) => !c.pass)
    for (const check of report.checks) {
      const mark = check.pass ? 'ok  ' : 'FAIL'
      console.log(`${mark}  ${check.name}  [${check.value}]  (want ${check.threshold})`)
    }
    console.log(
      `\n${report.checks.length - failed.length}/${report.checks.length} checks passed · ` +
        `draw avg ${report.drawMs.avg}ms p99 ${report.drawMs.p99}ms · ` +
        `sheet: shots/contact-sheet.png · report: shots/report.json`,
    )
    // Readable text, per song and per scene: the old scrim vs adaptive text.
    if (report.readability?.length) {
      const pct = (share) => `${(share * 100).toFixed(1)}%`.padStart(6)
      console.log('\nreadable text: share of samples at 3:1 or better, and the median ratio')
      for (const song of report.readability) {
        console.log(`  ${song.slug}`)
        console.log(`    ${'scene'.padEnd(12)} ${'old scrim'.padEnd(16)} ${'adaptive'.padEnd(16)} text   backing q/l/b/later   preset`)
        for (const scene of song.scenes) {
          console.log(
            `    ${scene.label.padEnd(12)} ` +
              `${pct(scene.before.pass)} ${scene.before.median.toFixed(1).padStart(5)}:1    ` +
              `${pct(scene.after.pass)} ${scene.after.median.toFixed(1).padStart(5)}:1    ` +
              `${String(scene.polarity).padEnd(6)} ${scene.strength.map((s) => s.toFixed(2)).join(' ')}   ` +
              `${scene.preset.slice(0, 40)}${scene.frames === 'rendered' ? '  (frames rendered now)' : ''}`,
          )
        }
      }
    }
    if (report.textDrawMs) {
      const t = report.textDrawMs
      console.log(
        `\ntext layer draw, hostile background: old scrim avg ${t.scrim.avg}ms p99 ${t.scrim.p99}ms · ` +
          `adaptive avg ${t.adaptive.avg}ms p99 ${t.adaptive.p99}ms · one background sample ${t.sampleMs}ms`,
      )
    }
    if (pageErrors.length > 0) {
      console.error('\npage errors:')
      for (const e of pageErrors) console.error('  -', e)
      exitCode = 1
    }
    if (failed.length > 0) exitCode = 1

    // Smoke test the real app on the fixture songs: the picker lists them,
    // the transport plays/scrubs, the help sheet opens, song switching
    // fully resets, and nothing logs an error. (?fixture=1 appends the
    // generated fixture songs to whatever library is present.)
    const app = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const appErrors = []
    const appFailures = []
    app.on('pageerror', (error) => appErrors.push(String(error)))
    app.on('console', (msg) => {
      if (msg.type() === 'error') appErrors.push(msg.text())
    })
    const expect = (pass, what) => {
      if (!pass) appFailures.push(what)
    }
    // Any write to the preset feedback file during the smoke test is a failure:
    // [ and ] only preview, and P (which does save) is never pressed here.
    const feedbackWrites = []
    app.on('request', (request) => {
      if (request.url().includes('/__presetFeedback')) feedbackWrites.push(request.method())
    })
    await app.goto(`${BASE}/?fixture=1`)

    // Start screen: the fixture songs are listed with their metadata.
    await app.waitForSelector('[data-song="fixture-a"]', { timeout: 10000 })
    expect((await app.textContent('[data-song="fixture-a"]')).includes('Paper Planets'), 'picker shows the fixture title')
    expect((await app.textContent('[data-song="fixture-b"]')).includes('neutral fallback'), 'picker shows the semantics source')

    // Open a song; the transport appears and playback starts on click.
    await app.click('[data-song="fixture-a"]')
    await app.waitForSelector('[data-testid="transport"]', { timeout: 10000 })
    expect(new URL(app.url()).searchParams.get('song') === 'fixture-a', '?song= follows the pick')
    await app.click('[data-action="play"]')
    await app.waitForTimeout(1500)
    const t1 = await app.evaluate(() => window.__app.audio.currentTime)
    expect(t1 > 0.4, `playback advances (got ${t1.toFixed(2)}s)`)

    // Scrub: a click near the end of the bar seeks there.
    const bar = await app.locator('.scrub').boundingBox()
    await app.mouse.click(bar.x + bar.width * 0.8, bar.y + bar.height / 2)
    const t2 = await app.evaluate(() => window.__app.audio.currentTime)
    expect(t2 > 15, `scrubbing seeks (got ${t2.toFixed(2)}s of 24s)`)
    expect((await app.locator('.scrub-section').count()) === 3, 'scrub bar carries one marker per section')

    // Help sheet on ? and away on Escape.
    await app.keyboard.press('?')
    expect(await app.isVisible('[data-testid="help"]'), 'help sheet opens on ?')
    await app.keyboard.press('Escape')
    expect(!(await app.isVisible('[data-testid="help"]')), 'help sheet closes on Escape')

    // [ and ] preview a candidate and say so; nothing is saved.
    await app.keyboard.press(']')
    await app.waitForTimeout(150)
    const previewToast = (await app.locator('.toast').first().textContent().catch(() => '')) ?? ''
    expect(
      /Previewing \d+ of \d+, not saved\. P to keep\./.test(previewToast),
      `] shows the preview message (got "${previewToast}")`,
    )
    await app.keyboard.press('[')
    await app.waitForTimeout(150)

    // Cycle to the canvas-scene background so there is something to sample,
    // then exercise every key once. No P or N here: those save feedback
    // through the dev endpoint and a verify run must not mutate
    // src/presetFeedback.json.
    await app.keyboard.press('b')
    for (const key of ['l', 'd', 's', 'k', 't', '{', '}', 'e', 'h', 'x', 'f', 'y', '1', '0', 'l', 'd', 's', 'k', 't'])
      await app.keyboard.press(key)
    await app.waitForTimeout(500)
    const sceneOk = await app.evaluate(() => {
      const canvas = document.querySelector('canvas.scene')
      if (!canvas) return 'no scene canvas'
      const ctx = canvas.getContext('2d')
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let min = 255
      let max = 0
      for (let i = 0; i < data.length; i += 97 * 4) {
        const v = data[i] + data[i + 1] + data[i + 2]
        if (v < min) min = v
        if (v > max) max = v
      }
      return max - min > 10 ? 'ok' : `canvas near-uniform (spread ${max - min})`
    })
    expect(sceneOk === 'ok', `scene canvas moves (${sceneOk})`)

    // Back to the picker, then switch songs: playback and title fully reset.
    await app.click('[data-action="back"]')
    await app.waitForSelector('[data-song="fixture-b"]', { timeout: 10000 })
    await app.click('[data-song="fixture-b"]')
    await app.waitForSelector('[data-testid="transport"]', { timeout: 10000 })
    await app.waitForTimeout(400)
    const after = await app.evaluate(() => ({
      time: window.__app.audio.currentTime,
      src: window.__app.audio.src,
      paused: window.__app.audio.paused,
    }))
    expect(after.src.includes('/fixture/fixture-b/'), 'switching swaps the audio source')
    expect(after.time < 2 && after.paused, `switching resets playback (t=${after.time.toFixed(2)}, paused=${after.paused})`)
    expect((await app.textContent('.now-title')).includes('Static Garden'), 'switching swaps the title')
    expect((await app.locator('.scrub-section').count()) === 2, 'switching swaps the section markers')

    expect(feedbackWrites.length === 0, `no key in the smoke test saved preset feedback (${feedbackWrites.length} writes)`)

    const appPass = appFailures.length === 0 && appErrors.length === 0
    const detail = [...appFailures, ...(appErrors.length ? ['errors: ' + appErrors.join(' | ')] : [])]
    console.log(`${appPass ? 'ok  ' : 'FAIL'}  app smoke test  [${appPass ? 'picker + transport + switch' : detail.join('; ')}]`)
    if (!appPass) exitCode = 1
  }
} catch (error) {
  console.error('shots failed:', error)
  if (serverOutput) console.error('--- vite output ---\n' + serverOutput.slice(-2000))
  exitCode = 1
} finally {
  if (browser) await browser.close()
  server.kill('SIGTERM')
}
process.exit(exitCode)
