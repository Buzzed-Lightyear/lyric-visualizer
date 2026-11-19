import { describe, expect, it } from 'vitest'
import { SpectrumReducer } from './audioMath'
import { ANALYSIS, BEAT } from './tuning'

const SAMPLE_RATE = 48000
const DT = 1 / 60
const BIN_COUNT = ANALYSIS.fftSize / 2
const HZ_PER_BIN = SAMPLE_RATE / ANALYSIS.fftSize

function spectrum(fill: (hz: number) => number): Uint8Array {
  const bins = new Uint8Array(BIN_COUNT)
  for (let i = 0; i < BIN_COUNT; i++) bins[i] = fill(i * HZ_PER_BIN)
  return bins
}

const silence = spectrum(() => 0)
const bassHit = spectrum((hz) => (hz <= 140 ? 230 : 0))

describe('SpectrumReducer', () => {
  it('gives zeros on silence', () => {
    const reducer = new SpectrumReducer(SAMPLE_RATE)
    let frame = reducer.update(silence, DT)
    for (let i = 0; i < 120; i++) frame = reducer.update(silence, DT)
    expect(frame.level).toBeLessThan(0.01)
    expect(frame.bass).toBeLessThan(0.01)
    expect(frame.mid).toBeLessThan(0.01)
    expect(frame.high).toBeLessThan(0.01)
    expect(frame.beat).toBeLessThan(0.01)
  })

  it('falls back to zero on null input (paused)', () => {
    const reducer = new SpectrumReducer(SAMPLE_RATE)
    for (let i = 0; i < 30; i++) reducer.update(bassHit, DT)
    let frame = reducer.update(null, DT)
    expect(frame.bass).toBeGreaterThan(0.1) // release is not instant
    for (let i = 0; i < 180; i++) frame = reducer.update(null, DT)
    expect(frame.bass).toBeLessThan(0.01)
    expect(frame.level).toBeLessThan(0.01)
    expect(frame.beat).toBeLessThan(0.01)
  })

  it('maps a bass-only hit to bass, not high', () => {
    const reducer = new SpectrumReducer(SAMPLE_RATE)
    let frame = reducer.update(bassHit, DT)
    for (let i = 0; i < 60; i++) frame = reducer.update(bassHit, DT)
    expect(frame.bass).toBeGreaterThan(0.8)
    expect(frame.high).toBeLessThan(0.05)
  })

  it('fires exactly one beat per pulse in a pulse train', () => {
    const reducer = new SpectrumReducer(SAMPLE_RATE)
    let fires = 0
    // 8 pulses, one frame each, 0.5 s apart (well past the refractory gap).
    for (let i = 0; i < 240; i++) {
      const frame = reducer.update(i % 30 === 0 ? bassHit : silence, DT)
      if (frame.beat === 1) fires++
    }
    expect(fires).toBe(8)
  })

  it('holds the refractory gap', () => {
    const reducer = new SpectrumReducer(SAMPLE_RATE)
    let fires = 0
    // Two pulses 0.1 s apart: inside the refractory window.
    for (let i = 0; i < 30; i++) {
      const frame = reducer.update(i === 0 || i === 6 ? bassHit : silence, DT)
      if (frame.beat === 1) fires++
    }
    expect(BEAT.refractorySec).toBeGreaterThan(0.1)
    expect(fires).toBe(1)
  })

  it('fires again once the refractory gap has passed', () => {
    const reducer = new SpectrumReducer(SAMPLE_RATE)
    let fires = 0
    // Two pulses 0.3 s apart: past the refractory window.
    for (let i = 0; i < 40; i++) {
      const frame = reducer.update(i === 0 || i === 18 ? bassHit : silence, DT)
      if (frame.beat === 1) fires++
    }
    expect(fires).toBe(2)
  })
})
