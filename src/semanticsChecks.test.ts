import { describe, expect, it } from 'vitest'
import type { LyricLine } from './lrc'
import { parseSemantics, type Semantics } from './semantics'
import {
  automaticChecks,
  diffReport,
  neutralSemantics,
  validateGenerated,
} from './semanticsChecks'
import { SemanticsOutputSchema, buildPrompt, repairFocus, stripNulls } from './semanticsGen'

// Made-up lyrics only.
const LINES: LyricLine[] = [
  { time: 2, text: 'fold the paper planes tonight' },
  { time: 6, text: 'send them out across the wire' },
  { time: 10, text: '' }, // instrumental marker
  { time: 20, text: 'fold the paper planes tonight' }, // refrain of line 0
  { time: 24, text: 'every window burns a little brighter' },
]

const DURATION = 30

const section = (over: Record<string, unknown> = {}) => ({
  start: 0,
  end: 30,
  label: 'part 1',
  energy: 0.5,
  mood: 'calm',
  palette: ['#0a0c12', '#5a6b8f', '#9aa7bf'],
  imagery: ['stars'],
  ...over,
})

const goodDoc = () => ({
  version: 2,
  sections: [section()],
  lines: [
    { time: 2, emphasis: 0.6, focus: [1], gesture: 'rise' },
    { time: 6, emphasis: 0.5, focus: [2] },
    { time: 20, emphasis: 0.6 },
    { time: 24, emphasis: 0.7, focus: [2] },
  ],
})

const parse = (doc: unknown): Semantics => {
  const { semantics, errors } = parseSemantics(doc)
  expect(errors).toEqual([])
  return semantics!
}

describe('automaticChecks', () => {
  it('passes a consistent document', () => {
    expect(automaticChecks(parse(goodDoc()), LINES, DURATION)).toEqual([])
  })

  it('flags sections that start late or end early', () => {
    const late = parse({ ...goodDoc(), sections: [section({ start: 5 })] })
    expect(automaticChecks(late, LINES, DURATION).join(' ')).toContain('first line')
    const short = parse({ ...goodDoc(), sections: [section({ end: 21 })] })
    expect(automaticChecks(short, LINES, DURATION).join(' ')).toContain('runs 30s')
  })

  it('flags a line outside every section', () => {
    const gap = parse({
      ...goodDoc(),
      sections: [section({ end: 8 }), section({ start: 21, label: 'part 2' })],
    })
    expect(automaticChecks(gap, LINES, DURATION).join(' ')).toContain('outside every section')
  })

  it('flags out-of-range focus indices', () => {
    const doc = goodDoc()
    doc.lines[1] = { time: 6, emphasis: 0.5, focus: [40] }
    expect(automaticChecks(parse(doc), LINES, DURATION).join(' ')).toContain('out of range')
  })

  it('flags a gesture share outside 15-40%', () => {
    const none = goodDoc()
    delete (none.lines[0] as Record<string, unknown>).gesture
    expect(automaticChecks(parse(none), LINES, DURATION).join(' ')).toContain('%')
    const all = goodDoc()
    all.lines = all.lines.map((line) => ({ ...line, focus: [0], gesture: 'fall' }))
    expect(automaticChecks(parse(all), LINES, DURATION).join(' ')).toContain('%')
  })

  it('flags same-label sections that disagree', () => {
    const doc = {
      ...goodDoc(),
      sections: [
        section({ end: 15 }),
        section({ start: 15, energy: 0.9 }), // same label, different energy
      ],
    }
    expect(automaticChecks(parse(doc), LINES, DURATION).join(' ')).toContain('disagree')
  })

  it('flags a refrain whose gesture contradicts its source', () => {
    const doc = goodDoc()
    doc.lines[2] = { time: 20, emphasis: 0.6, focus: [0], gesture: 'halt' } // repeats t=2 ("rise")
    expect(automaticChecks(parse(doc), LINES, DURATION).join(' ')).toContain('different gesture')
  })

  it('accepts a refrain with no annotation of its own', () => {
    expect(automaticChecks(parse(goodDoc()), LINES, DURATION)).toEqual([])
  })
})

describe('neutralSemantics', () => {
  it('builds a valid v2 document with sections at the gaps', () => {
    const doc = neutralSemantics(LINES, DURATION)
    const { semantics, errors } = parseSemantics(doc)
    expect(errors).toEqual([])
    // 6 -> 20 is a 14s gap: two parts.
    expect(semantics!.sections.map((s) => s.label)).toEqual(['part 1', 'part 2'])
    expect(semantics!.sections[1].start).toBe(20)
    expect(semantics!.sections[1].end).toBe(DURATION)
    expect(semantics!.lines).toHaveLength(4) // the empty line is skipped
    expect(semantics!.lines.every((line) => !line.gesture && !line.focus)).toBe(true)
  })

  it('survives an empty lyric file', () => {
    const { errors } = parseSemantics(neutralSemantics([], 30))
    expect(errors).toEqual([])
  })
})

describe('validateGenerated', () => {
  it('accepts a good document and rejects schema or check failures', () => {
    expect(validateGenerated(goodDoc(), LINES, DURATION).semantics).not.toBeNull()
    expect(validateGenerated({ nonsense: true }, LINES, DURATION).semantics).toBeNull()
    const bad = goodDoc()
    bad.sections = [section({ start: 15 })]
    const { semantics, errors } = validateGenerated(bad, LINES, DURATION)
    expect(semantics).toBeNull()
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('diffReport', () => {
  it('reports boundaries, focus overlap and gesture agreement', () => {
    const existing = parse(goodDoc())
    const changed = goodDoc()
    changed.lines[0] = { time: 2, emphasis: 0.6, focus: [1, 3], gesture: 'rise' }
    changed.lines[3] = { time: 24, emphasis: 0.7, focus: [4] }
    const report = diffReport(existing, parse(changed)).join('\n')
    expect(report).toContain('sections:')
    expect(report).toContain('boundaries within 3s of an existing one: 1 of 1')
    expect(report).toContain('3 lines annotated in both; 2 share at least one focus word')
    expect(report).toContain('1 lines gestured in both (1 same gesture)')
  })
})

describe('extraction schema and prompt', () => {
  it('round-trips a model output through stripNulls into a valid file', () => {
    const output = SemanticsOutputSchema.parse({
      version: 2,
      sections: [section()],
      lines: [
        { time: 2, emphasis: 0.6, focus: [1], gesture: 'rise', direction: null },
        { time: 6, emphasis: 0.5, focus: null, gesture: null, direction: null },
      ],
    })
    const doc = stripNulls(output)
    const { semantics, errors } = parseSemantics(doc)
    expect(errors).toEqual([])
    expect(semantics!.lines[1]).toEqual({ time: 6, emphasis: 0.5 })
  })

  it('repairs out-of-range focus instead of failing the document', () => {
    const output = SemanticsOutputSchema.parse({
      version: 2,
      sections: [section()],
      lines: [
        // index 3 is one past the end of a 3-word line: dropped, 1 kept.
        { time: 2, emphasis: 0.6, focus: [1, 3], gesture: 'rise', direction: null },
        // the only focus index is bad: focus, gesture and direction all go.
        { time: 6, emphasis: 0.5, focus: [7], gesture: 'halt', direction: 'left' },
        // in range: untouched.
        { time: 10, emphasis: 0.5, focus: [0], gesture: null, direction: null },
        // no matching lyric line: left for validateFocusRanges to report.
        { time: 99, emphasis: 0.5, focus: [5], gesture: null, direction: null },
      ],
    })
    const notes = repairFocus(output, [
      { time: 2, wordCount: 3 },
      { time: 6, wordCount: 4 },
      { time: 10, wordCount: 2 },
    ])
    expect(notes).toHaveLength(2)
    expect(notes[0]).toContain('dropped out-of-range focus 3')
    expect(notes[1]).toContain('"halt" gesture')
    expect(output.lines[0].focus).toEqual([1])
    expect(output.lines[0].gesture).toBe('rise')
    expect(output.lines[1].focus).toBeNull()
    expect(output.lines[1].gesture).toBeNull()
    expect(output.lines[1].direction).toBeNull()
    expect(output.lines[2].focus).toEqual([0])
    expect(output.lines[3].focus).toEqual([5])
  })

  it('builds a prompt with indexed words and no unending lines', () => {
    const prompt = buildPrompt({
      title: 'Paper Planets',
      artist: 'The Invented Band',
      durationSec: 30,
      lines: [{ index: 0, time: 2, words: ['fold', 'the', 'paper'] }],
    })
    expect(prompt).toContain('0:fold 1:the 2:paper')
    expect(prompt).toContain('third of the lines')
    expect(prompt).toContain('NO lyric text')
  })
})
