import { describe, expect, it } from 'vitest'
import { buildChoreo, lineWords, refrainSources } from './choreo'
import type { Semantics, SemanticSection } from './semantics'

// Made-up lines only; real lyrics never enter the repo.

const section = (over: Partial<SemanticSection>): SemanticSection => ({
  start: 0,
  end: 10,
  label: 'test',
  energy: 0.5,
  mood: 'calm',
  palette: ['#102030', '#ff8040', '#a0b0c0'],
  imagery: [],
  ...over,
})

describe('refrainSources', () => {
  it('detects exact repeats, ignoring case and punctuation', () => {
    const texts = [
      'Shadows march over the hill',
      'a different line entirely here',
      'shadows march, over the hill!',
    ]
    expect(refrainSources(texts)).toEqual([null, null, 0])
  })

  it('points chains at the first occurrence', () => {
    const texts = ['echo the same words', 'echo the same words', 'echo the same words']
    expect(refrainSources(texts)).toEqual([null, 0, 0])
  })

  it('accepts a shorter reprise and a cut-off last word', () => {
    const texts = [
      'walk the long road home tonight my friend',
      'walk the long road home tonight',
      'you open your eyes to look around',
      'you open your eyes to look ar-',
    ]
    expect(refrainSources(texts)).toEqual([null, 0, null, 2])
  })

  it('rejects short overlaps and different lines', () => {
    const texts = [
      'one two three four five six',
      'one two different four five six',
      'one two',
      'one two three',
    ]
    // Line 3 shares only half the words of line 0; line 2 is too short.
    expect(refrainSources(texts)).toEqual([null, null, null, null])
  })
})

describe('buildChoreo', () => {
  const sections = [
    section({ start: 0, end: 10, label: 'a', mood: 'menacing', energy: 0.8 }),
    section({ start: 10, end: 20, label: 'b', mood: 'calm', energy: 0.2 }),
  ]
  const semantics: Semantics = {
    sections,
    lines: [
      { time: 1, emphasis: 0.8, focus: [0, 2], gesture: 'strike' },
      { time: 5, emphasis: 0.5, focus: [1] },
      { time: 15, emphasis: 0.5 },
    ],
  }

  it('gives every line in a section the same base grammar', () => {
    const choreo = buildChoreo(
      [
        { time: 1, text: 'invented words fly here' },
        { time: 5, text: 'other made up words' },
      ],
      semantics,
    )
    expect(choreo[0].grammar).toEqual(choreo[1].grammar)
    expect(choreo[0].grammar.hold).toBe('jolt')
  })

  it('puts a directed gesture on the focus words', () => {
    const [choreo] = buildChoreo([{ time: 1, text: 'invented words fly here' }], semantics)
    expect(choreo.focus).toEqual([0, 2])
    expect(choreo.gestures).toEqual([
      { index: 0, gesture: 'strike', dir: null, source: 'direction' },
      { index: 2, gesture: 'strike', dir: null, source: 'direction' },
    ])
  })

  it('falls back to the lexicon when the line has no direction', () => {
    const [choreo] = buildChoreo(
      [{ time: 5, text: 'they keep falling while we wait' }],
      semantics,
    )
    expect(choreo.focus).toEqual([1])
    expect(choreo.gestures).toEqual([
      { index: 2, gesture: 'fall', dir: null, source: 'lexicon' },
      { index: 5, gesture: 'halt', dir: null, source: 'lexicon' },
    ])
  })

  it('drops out-of-range focus indices', () => {
    const [choreo] = buildChoreo([{ time: 1, text: 'two words' }], semantics)
    expect(choreo.focus).toEqual([0]) // index 2 is out of range
  })

  it('reuses a refrain source line exactly, across sections', () => {
    const choreo = buildChoreo(
      [
        { time: 1, text: 'invented words fly here' },
        { time: 15, text: 'Invented words, fly here' },
      ],
      semantics,
    )
    expect(choreo[1].refrainOf).toBe(0)
    expect(choreo[1].grammar).toEqual(choreo[0].grammar) // not section b's
    expect(choreo[1].gestures).toEqual(choreo[0].gestures)
    expect(choreo[1].focus).toEqual(choreo[0].focus)
  })

  it('handles missing semantics with the neutral grammar', () => {
    const [choreo] = buildChoreo([{ time: 1, text: 'plain made up line' }], null)
    expect(choreo.grammar.voice).toBe('air')
    expect(choreo.focus).toEqual([])
  })

  it('splits words like the layouts do', () => {
    expect(lineWords('  spaced   out words ')).toEqual(['spaced', 'out', 'words'])
  })
})
