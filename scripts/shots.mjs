/**
 * npm run shots: drive the visual harness headlessly, write
 * shots/contact-sheet.png and shots/report.json, and fail on the checks
 * defined in src/thresholds.ts.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { chromium } from 'playwright'

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

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
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
    if (pageErrors.length > 0) {
      console.error('\npage errors:')
      for (const e of pageErrors) console.error('  -', e)
      exitCode = 1
    }
    if (failed.length > 0) exitCode = 1

    // Smoke test the real app: loads, draws its idle scene, takes the
    // L/D/S keys, and logs no errors. (Playback itself needs a human.)
    const app = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const appErrors = []
    app.on('pageerror', (error) => appErrors.push(String(error)))
    app.on('console', (msg) => {
      if (msg.type() === 'error') appErrors.push(msg.text())
    })
    await app.goto(BASE)
    await app.waitForTimeout(1500)
    // Cycle to the canvas-scene background so there is something to sample
    // (butterchurn needs a play gesture), then exercise every key once.
    // No [ ] or N here: those save feedback through the dev endpoint and
    // a verify run must not mutate src/presetFeedback.json.
    await app.keyboard.press('b')
    for (const key of ['l', 'd', 's', 'k', 't', '{', '}', 'e', 'h', 'x', 'f', 'y', '1', '0', 'l', 'd', 's', 'k', 't'])
      await app.keyboard.press(key)
    await app.waitForTimeout(500)
    const appOk = await app.evaluate(() => {
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
    const appPass = appOk === 'ok' && appErrors.length === 0
    console.log(`${appPass ? 'ok  ' : 'FAIL'}  app smoke test  [${appOk}${appErrors.length ? '; errors: ' + appErrors.join(' | ') : ''}]`)
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
