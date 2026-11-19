import { describe, expect, it } from 'vitest'
import { ENTRANCE_NAMES, ENTRANCES, EXIT_NAMES, EXITS, HOLDS } from './parts'
import { createRandom } from './random'
import { advance, newBody, ZERO_FORCES, type SpringConfig } from './springs'
import { ASSIST, LEGIBILITY } from './tuning'

const SLOT = { x: 0.5, y: 0.45 }

describe('entrances', () => {
  it('initialize deterministically and finitely', () => {
    for (const name of ENTRANCE_NAMES) {
      const a = newBody(SLOT.x, SLOT.y)
      const b = newBody(SLOT.x, SLOT.y)
      ENTRANCES[name].init(a, SLOT.x, SLOT.y, createRandom(7), 1)
      ENTRANCES[name].init(b, SLOT.x, SLOT.y, createRandom(7), 1)
      expect(a).toEqual(b)
      for (const value of Object.values(a)) expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('unfold deforms from flat to fully open', () => {
    const deform = ENTRANCES.unfold.deform!
    expect(deform(0)).toBe(0)
    expect(deform(ENTRANCES.unfold.duration / 2)).toBeGreaterThan(0.1)
    expect(deform(ENTRANCES.unfold.duration * 2)).toBeNull() // open = no deform
  })
})

describe('exits', () => {
  const words = [
    { x: 0.3, y: 0.4 },
    { x: 0.5, y: 0.4 },
    { x: 0.7, y: 0.4 },
  ]

  it('produce one finite motion per word', () => {
    for (const name of EXIT_NAMES) {
      const motions = EXITS[name].begin(words, createRandom(3), 1, [{ x: 0.5, y: 0.45 }])
      expect(motions).toHaveLength(words.length)
      for (const m of motions) {
        for (const value of Object.values(m)) expect(Number.isFinite(value)).toBe(true)
      }
    }
  })

  it('blow staggers words and sweeps them one way', () => {
    const motions = EXITS.blow.begin(words, createRandom(3), 1, [])
    const signs = new Set(motions.map((m) => Math.sign(m.vx)))
    expect(signs.size).toBe(1)
    expect(motions[2].delay).toBeGreaterThan(motions[0].delay)
  })

  it('sink pulls toward the line center', () => {
    const motions = EXITS.sink.begin(words, createRandom(3), 1, [])
    expect(motions[0].vx).toBeGreaterThan(0) // left word moves right
    expect(motions[2].vx).toBeLessThan(0) // right word moves left
    expect(motions[0].scaleRate).toBeLessThan(0)
  })

  it('knock pushes away from the nearest incoming slot', () => {
    const motions = EXITS.knock.begin(
      [{ x: 0.4, y: 0.45 }],
      createRandom(3),
      1,
      [{ x: 0.5, y: 0.45 }],
    )
    expect(motions[0].vx).toBeLessThan(0) // shoved away leftward
  })
})

describe('legibility assist', () => {
  const assistWeight = (u: number): number => {
    if (u <= ASSIST.rampStart) return 0
    const t = Math.min(1, (u - ASSIST.rampStart) / (1 - ASSIST.rampStart))
    return t * t * (3 - 2 * t)
  }
  const withAssist = (base: SpringConfig, w: number): SpringConfig => ({
    k: base.k + w * ASSIST.k,
    c: base.c + w * ASSIST.c,
    kRot: base.kRot + w * ASSIST.kRot,
    cRot: base.cRot + w * ASSIST.cRot,
    kScale: base.kScale,
    cScale: base.cScale,
  })

  it('brings a weak hold into its slot by the deadline, without pinning', () => {
    // Buoy entrance into the weakest hold (bob): without assist the
    // spring alone would still be far out at the settle deadline.
    const home = { x: SLOT.x, y: SLOT.y, rot: 0, scale: 1 }
    const body = newBody(SLOT.x, SLOT.y)
    ENTRANCES.buoy.init(body, SLOT.x, SLOT.y, createRandom(5), 1.5)
    const base = HOLDS.bob.spring()
    const dt = 1 / 60
    const tolFrac = (LEGIBILITY.slotTolFrac * 50) / 720 // ~a 50px word on 720p
    for (let t = 0; t < LEGIBILITY.settleSec; t += dt) {
      const w = assistWeight(t / LEGIBILITY.settleSec)
      advance(body, home, withAssist(base, w), ZERO_FORCES, dt)
    }
    expect(Math.hypot(body.x - SLOT.x, body.y - SLOT.y)).toBeLessThanOrEqual(tolFrac)
    // Not pinned: with a bass bob force it keeps moving inside the zone.
    let minX = Infinity
    let maxX = -Infinity
    for (let t = 0; t < 1; t += dt) {
      advance(
        body,
        home,
        withAssist(base, 1),
        { ax: Math.sin(t * 6) * 0.3, ay: 0, aRot: 0, aScale: 0 },
        dt,
      )
      minX = Math.min(minX, body.x)
      maxX = Math.max(maxX, body.x)
      expect(Math.abs(body.x - SLOT.x)).toBeLessThanOrEqual(tolFrac)
    }
    expect(maxX - minX).toBeGreaterThan(0.0001)
  })
})
