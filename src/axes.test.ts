import { describe, expect, it } from 'vitest'
import {
  ANCHOR_NAMES,
  axesDistance,
  MOOD_ANCHORS,
  moodAxes,
  motionForAxes,
  nearestAnchor,
  NEUTRAL_AXES,
  sectionAxes,
  type MoodAxes,
} from './axes'
import { paramsForSection, sectionGrammar } from './mapping'
import { targetForSection } from './presetPick'
import type { SemanticSection } from './semantics'

/**
 * The three mood tables exactly as they stood in semantics version 2
 * (src/mapping.ts before the axes took over). Kept here as literals: the
 * tests below hold the axes-driven mapping to them, word for word.
 */
const V2_MOTION: Record<string, { jitter: number; lift: number }> = {
  calm: { jitter: 0.5, lift: 0.1 },
  tense: { jitter: 1.4, lift: 0 },
  menacing: { jitter: 1.6, lift: -0.15 },
  furious: { jitter: 2, lift: -0.1 },
  weary: { jitter: 0.7, lift: -0.25 },
  grieving: { jitter: 0.55, lift: -0.4 },
  mournful: { jitter: 0.6, lift: 0.25 },
  brooding: { jitter: 0.9, lift: -0.15 },
  hollow: { jitter: 0.5, lift: 0 },
  suspended: { jitter: 0.4, lift: 0.3 },
}
const V2_TEXT: Record<string, { hold: string; voice: string; accentVoice: string; anchor: string }> = {
  calm: { hold: 'bob', voice: 'air', accentVoice: 'condensed', anchor: 'center' },
  mournful: { hold: 'bob', voice: 'whisper', accentVoice: 'condensed', anchor: 'center' },
  suspended: { hold: 'still', voice: 'air', accentVoice: 'condensed', anchor: 'center' },
  tense: { hold: 'tremble', voice: 'mono', accentVoice: 'marker', anchor: 'upperLeft' },
  menacing: { hold: 'jolt', voice: 'condensed', accentVoice: 'marker', anchor: 'low' },
  furious: { hold: 'jolt', voice: 'block', accentVoice: 'marker', anchor: 'center' },
  weary: { hold: 'pendulum', voice: 'slab', accentVoice: 'marker', anchor: 'low' },
  grieving: { hold: 'still', voice: 'serif', accentVoice: 'condensed', anchor: 'center' },
  brooding: { hold: 'pendulum', voice: 'serif', accentVoice: 'marker', anchor: 'low' },
  hollow: { hold: 'still', voice: 'mono', accentVoice: 'condensed', anchor: 'upperLeft' },
}
const V2_AXES: Record<string, MoodAxes> = {
  calm: { arousal: 0.2, valence: 0.6, tension: 0.2, warmth: 0.5 },
  mournful: { arousal: 0.25, valence: 0.3, tension: 0.3, warmth: 0.35 },
  suspended: { arousal: 0.3, valence: 0.5, tension: 0.35, warmth: 0.4 },
  tense: { arousal: 0.6, valence: 0.35, tension: 0.75, warmth: 0.45 },
  menacing: { arousal: 0.7, valence: 0.2, tension: 0.8, warmth: 0.55 },
  furious: { arousal: 0.95, valence: 0.15, tension: 0.9, warmth: 0.75 },
  weary: { arousal: 0.35, valence: 0.35, tension: 0.4, warmth: 0.5 },
  grieving: { arousal: 0.3, valence: 0.2, tension: 0.45, warmth: 0.35 },
  brooding: { arousal: 0.45, valence: 0.25, tension: 0.55, warmth: 0.45 },
  hollow: { arousal: 0.3, valence: 0.3, tension: 0.5, warmth: 0.3 },
}
const V2_UNKNOWN_MOTION = { jitter: 1, lift: 0 }
const V2_UNKNOWN_TEXT = { hold: 'bob', voice: 'air', accentVoice: 'marker', anchor: 'center' }
const V2_MOODS = Object.keys(V2_AXES)

const v2Section = (mood: string): SemanticSection => ({
  start: 0,
  end: 10,
  label: 'test',
  energy: 0.5,
  mood,
  palette: ['#102030', '#ff8040', '#a0b0c0', '#ffffff'],
  imagery: ['embers'],
})

describe('version 2 files map to the same result through the axes', () => {
  it.each(V2_MOODS)('%s: same jitter and lift, exactly', (mood) => {
    const params = paramsForSection(v2Section(mood), 0.5)
    expect(params.jitter).toBe(V2_MOTION[mood].jitter)
    expect(params.lift).toBe(V2_MOTION[mood].lift)
  })

  it.each(V2_MOODS)('%s: same hold, voices and anchor', (mood) => {
    const { hold, voice, accentVoice, anchor } = sectionGrammar(v2Section(mood))
    expect({ hold, voice, accentVoice, anchor }).toEqual(V2_TEXT[mood])
  })

  it.each(V2_MOODS)('%s: same axes for the scorer', (mood) => {
    expect(moodAxes(mood)).toEqual(V2_AXES[mood])
    expect(targetForSection(v2Section(mood)).axes).toEqual(V2_AXES[mood])
  })

  it('keeps mood words case-insensitive', () => {
    expect(sectionGrammar(v2Section('Menacing')).hold).toBe('jolt')
    expect(paramsForSection(v2Section('MOURNFUL'), 0.5).lift).toBe(0.25)
  })

  it('keeps unknown mood words neutral, as they always were', () => {
    for (const mood of ['neutral', 'zorblax', 'sun-drunk', 'constructor']) {
      const params = paramsForSection(v2Section(mood), 0.5)
      expect({ jitter: params.jitter, lift: params.lift }).toEqual(V2_UNKNOWN_MOTION)
      const { hold, voice, accentVoice, anchor } = sectionGrammar(v2Section(mood))
      expect({ hold, voice, accentVoice, anchor }).toEqual(V2_UNKNOWN_TEXT)
      expect(targetForSection(v2Section(mood)).axes).toEqual(NEUTRAL_AXES)
    }
    const none = sectionGrammar(null)
    expect({ hold: none.hold, voice: none.voice, accentVoice: none.accentVoice, anchor: none.anchor }).toEqual(
      V2_UNKNOWN_TEXT,
    )
  })

  it('keeps every anchor a distinct point, so none can shadow another', () => {
    for (const a of ANCHOR_NAMES) {
      expect(nearestAnchor(MOOD_ANCHORS[a].axes).name).toBe(a)
      for (const b of ANCHOR_NAMES) {
        if (a !== b) expect(axesDistance(MOOD_ANCHORS[a].axes, MOOD_ANCHORS[b].axes)).toBeGreaterThan(0.05)
      }
    }
  })
})

describe('any mood word works: the axes decide', () => {
  const free = (axes: MoodAxes, mood = 'sun-drunk, restless'): SemanticSection => ({
    ...v2Section(mood),
    axes,
  })

  it('reads the section axes, not the mood word', () => {
    // Called "calm", placed on furious: the numbers win.
    const section = free(V2_AXES.furious, 'calm')
    expect(sectionAxes(section)).toEqual(V2_AXES.furious)
    expect(sectionGrammar(section).hold).toBe('jolt')
    expect(paramsForSection(section, 0.5).jitter).toBe(2)
  })

  it('gives an unlisted mood the type of its nearest anchor', () => {
    const nearGrieving = free({ arousal: 0.31, valence: 0.19, tension: 0.46, warmth: 0.36 })
    expect(nearestAnchor(sectionAxes(nearGrieving)).name).toBe('grieving')
    expect(sectionGrammar(nearGrieving).hold).toBe('still')
    expect(sectionGrammar(nearGrieving).anchor).toBe('center')
  })

  it('is deterministic', () => {
    const axes = { arousal: 0.62, valence: 0.71, tension: 0.33, warmth: 0.84 }
    expect(motionForAxes(axes)).toEqual(motionForAxes({ ...axes }))
    expect(nearestAnchor(axes).name).toBe(nearestAnchor({ ...axes }).name)
  })
})

describe('axes mapping continuity', () => {
  const lerp = (a: MoodAxes, b: MoodAxes, t: number): MoodAxes => ({
    arousal: a.arousal + (b.arousal - a.arousal) * t,
    valence: a.valence + (b.valence - a.valence) * t,
    tension: a.tension + (b.tension - a.tension) * t,
    warmth: a.warmth + (b.warmth - a.warmth) * t,
  })
  const jitters = ANCHOR_NAMES.map((name) => MOOD_ANCHORS[name].jitter)
  const lifts = ANCHOR_NAMES.map((name) => MOOD_ANCHORS[name].lift)

  it('is exact on every anchor', () => {
    for (const name of ANCHOR_NAMES) {
      const anchor = MOOD_ANCHORS[name]
      expect(motionForAxes(anchor.axes)).toEqual({ jitter: anchor.jitter, lift: anchor.lift })
    }
  })

  it('approaches an anchor smoothly: no jump on arrival', () => {
    for (const name of ANCHOR_NAMES) {
      const anchor = MOOD_ANCHORS[name]
      const near = motionForAxes({ ...anchor.axes, arousal: anchor.axes.arousal + 1e-4 })
      expect(Math.abs(near.jitter - anchor.jitter)).toBeLessThan(1e-6)
      expect(Math.abs(near.lift - anchor.lift)).toBeLessThan(1e-6)
    }
  })

  it('never jumps on the way from any anchor to any other', () => {
    const STEPS = 2000
    let worst = 0
    for (const a of ANCHOR_NAMES) {
      for (const b of ANCHOR_NAMES) {
        if (a >= b) continue
        let prev = motionForAxes(MOOD_ANCHORS[a].axes)
        for (let i = 1; i <= STEPS; i++) {
          const next = motionForAxes(lerp(MOOD_ANCHORS[a].axes, MOOD_ANCHORS[b].axes, i / STEPS))
          worst = Math.max(worst, Math.abs(next.jitter - prev.jitter), Math.abs(next.lift - prev.lift))
          prev = next
        }
      }
    }
    // The largest gap between two anchors is 1.6 in jitter; a 1/2000 step
    // of the path may move the value by a small fraction of that.
    expect(worst).toBeLessThan(0.01)
  })

  it('stays inside the range the anchors span, everywhere', () => {
    // A fixed lattice over the whole cube, corners included.
    const grid = [0, 0.25, 0.5, 0.75, 1]
    for (const arousal of grid)
      for (const valence of grid)
        for (const tension of grid)
          for (const warmth of grid) {
            const { jitter, lift } = motionForAxes({ arousal, valence, tension, warmth })
            expect(jitter).toBeGreaterThanOrEqual(Math.min(...jitters))
            expect(jitter).toBeLessThanOrEqual(Math.max(...jitters))
            expect(lift).toBeGreaterThanOrEqual(Math.min(...lifts))
            expect(lift).toBeLessThanOrEqual(Math.max(...lifts))
          }
  })

  it('moves the way the anchors point: more arousal and tension, more jitter', () => {
    const quiet = motionForAxes({ arousal: 0.15, valence: 0.6, tension: 0.15, warmth: 0.5 })
    const loud = motionForAxes({ arousal: 0.9, valence: 0.2, tension: 0.9, warmth: 0.7 })
    expect(loud.jitter).toBeGreaterThan(quiet.jitter + 0.8)
  })

  it('holds the nearest anchor steady around each anchor', () => {
    for (const name of ANCHOR_NAMES) {
      const { axes } = MOOD_ANCHORS[name]
      for (const d of [-0.02, 0.02]) {
        expect(nearestAnchor({ ...axes, valence: axes.valence + d }).name).toBe(name)
      }
    }
  })
})
