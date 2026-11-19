import { describe, expect, it } from 'vitest'
import { advance, newBody, ZERO_FORCES, type SpringConfig } from './springs'
import { HOLD_T } from './tuning'

const HOME = { x: 0.5, y: 0.5, rot: 0, scale: 1 }

const springs: Record<string, SpringConfig> = Object.fromEntries(
  (['jolt', 'rest', 'bob', 'tremble', 'pendulum'] as const).map((name) => [
    name,
    {
      k: HOLD_T[name].k,
      c: HOLD_T[name].c,
      kRot: HOLD_T[name].kRot,
      cRot: HOLD_T[name].cRot,
      kScale: 90,
      cScale: 12,
    },
  ]),
)

describe('spring core', () => {
  it('settles a displaced body onto its home', () => {
    for (const s of Object.values(springs)) {
      const body = newBody(0.1, 0.9)
      body.rot = 0.4
      body.scale = 2
      for (let i = 0; i < 60 * 6; i++) advance(body, HOME, s, ZERO_FORCES, 1 / 60)
      expect(Math.abs(body.x - HOME.x)).toBeLessThan(0.01)
      expect(Math.abs(body.y - HOME.y)).toBeLessThan(0.01)
      expect(Math.abs(body.vx)).toBeLessThan(0.01)
      expect(Math.abs(body.rot)).toBeLessThan(0.05)
      expect(Math.abs(body.scale - 1)).toBeLessThan(0.05)
    }
  })

  it('never blows up under the clamped worst-case frame time', () => {
    for (const s of Object.values(springs)) {
      const body = newBody(0, 0)
      body.vx = 5
      body.vy = -5
      // 10 s of worst-case 100 ms frames with a strong constant force.
      for (let i = 0; i < 100; i++) {
        advance(body, HOME, s, { ax: 3, ay: -3, aRot: 5, aScale: 2 }, 0.1)
        expect(Number.isFinite(body.x)).toBe(true)
        expect(Number.isFinite(body.rot)).toBe(true)
      }
      expect(Math.abs(body.x)).toBeLessThan(100)
      expect(Math.abs(body.y)).toBeLessThan(100)
      expect(Math.abs(body.scale)).toBeLessThan(100)
    }
  })

  it('is frame-rate independent for substep-aligned frames', () => {
    const run = (frameDt: number, frames: number) => {
      const body = newBody(0.1, 0.8)
      for (let i = 0; i < frames; i++) {
        advance(body, HOME, springs.jolt, ZERO_FORCES, frameDt)
      }
      return body
    }
    const at60 = run(1 / 60, 120) // 2 s at 60 fps
    const at20 = run(1 / 20, 40) // 2 s at 20 fps
    expect(at20.x).toBeCloseTo(at60.x, 6)
    expect(at20.y).toBeCloseTo(at60.y, 6)
    expect(at20.vrot).toBeCloseTo(at60.vrot, 6)
  })

  it('bounces on a floor and never passes through it', () => {
    const body = newBody(0.5, 0.1)
    const floor = { y: 0.5, restitution: 0.45 }
    let maxY = 0
    for (let i = 0; i < 60 * 5; i++) {
      advance(body, HOME, springs.rest, { ...ZERO_FORCES, ay: HOLD_T.rest.gravity }, 1 / 60, floor)
      maxY = Math.max(maxY, body.y)
    }
    expect(maxY).toBeLessThanOrEqual(floor.y + 1e-9)
    expect(Math.abs(body.y - floor.y)).toBeLessThan(0.01) // settled on the floor
  })
})
