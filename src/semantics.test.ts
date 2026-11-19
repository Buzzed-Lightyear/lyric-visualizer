import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  activeSectionIndex,
  DEFAULT_EMPHASIS,
  emphasisAt,
  lineAnnotation,
  parseSemantics,
  validateFocusRanges,
} from './semantics'

const fixture = () =>
  JSON.parse(
    fs.readFileSync(new URL('../public/song/song.semantics.json', import.meta.url), 'utf8'),
  ) as unknown

describe('parseSemantics', () => {
  it('accepts the committed fixture', () => {
    const { semantics, errors } = parseSemantics(fixture())
    expect(errors).toEqual([])
    expect(semantics).not.toBeNull()
    expect(semantics!.sections.length).toBeGreaterThan(3)
  })

  it('rejects a non-object root readably', () => {
    const { semantics, errors } = parseSemantics('nope')
    expect(semantics).toBeNull()
    expect(errors[0]).toMatch(/root must be an object/)
  })

  it('reports out-of-range and malformed fields with the section named', () => {
    const { semantics, errors } = parseSemantics({
      sections: [
        {
          start: 10,
          end: 5,
          label: 'bad',
          energy: 2,
          mood: '',
          palette: ['#xyz'],
          imagery: [1],
        },
      ],
    })
    expect(semantics).toBeNull()
    expect(errors.join('\n')).toMatch(/"end" \(5\) must be after "start" \(10\)/)
    expect(errors.join('\n')).toMatch(/"energy" must be a number in 0\.\.1/)
    expect(errors.join('\n')).toMatch(/3-5 hex colors/)
    expect(errors.every((e) => e.includes('("bad")'))).toBe(true)
  })

  it('reports overlapping sections by label and time', () => {
    const section = (start: number, end: number, label: string) => ({
      start,
      end,
      label,
      energy: 0.5,
      mood: 'calm',
      palette: ['#000000', '#111111', '#222222'],
      imagery: [],
    })
    const { semantics, errors } = parseSemantics({
      sections: [section(0, 20, 'a'), section(15, 30, 'b')],
    })
    expect(semantics).toBeNull()
    expect(errors[0]).toMatch(/"a" \(0-20s\) overlaps "b" \(15-30s\)/)
  })

  it('rejects bad emphasis lines', () => {
    const { errors } = parseSemantics({
      sections: [
        {
          start: 0,
          end: 10,
          label: 'a',
          energy: 0.5,
          mood: 'calm',
          palette: ['#000000', '#111111', '#222222'],
          imagery: [],
        },
      ],
      lines: [{ time: -1, emphasis: 2 }],
    })
    expect(errors[0]).toMatch(/lines\[0\]/)
  })
})

describe('parseSemantics v2 directions', () => {
  const base = {
    sections: [
      {
        start: 0,
        end: 10,
        label: 'a',
        energy: 0.5,
        mood: 'calm',
        palette: ['#000000', '#111111', '#222222'],
        imagery: [],
      },
    ],
  }
  const parse = (line: Record<string, unknown>) =>
    parseSemantics({ ...base, version: 2, lines: [{ time: 1, emphasis: 0.5, ...line }] })

  it('accepts focus, gesture and direction together', () => {
    const { semantics, errors } = parse({ focus: [0, 2], gesture: 'fall', direction: 'down' })
    expect(errors).toEqual([])
    expect(semantics!.lines[0].focus).toEqual([0, 2])
    expect(semantics!.lines[0].gesture).toBe('fall')
    expect(semantics!.lines[0].direction).toBe('down')
  })

  it('still parses v1 files (all new fields optional)', () => {
    const { semantics, errors } = parseSemantics({
      ...base,
      lines: [{ time: 1, emphasis: 0.5 }],
    })
    expect(errors).toEqual([])
    expect(semantics!.lines[0].focus).toBeUndefined()
  })

  it('rejects malformed focus: too many, negative, fractional, duplicate', () => {
    expect(parse({ focus: [0, 1, 2] }).errors[0]).toMatch(/1-2 distinct word indices/)
    expect(parse({ focus: [-1] }).errors[0]).toMatch(/indices >= 0/)
    expect(parse({ focus: [0.5] }).errors[0]).toMatch(/indices/)
    expect(parse({ focus: [1, 1] }).errors[0]).toMatch(/distinct/)
  })

  it('rejects unknown gestures and directions, and bad dependencies', () => {
    expect(parse({ focus: [0], gesture: 'explode' }).errors[0]).toMatch(/"gesture" must be one of/)
    expect(parse({ gesture: 'fall' }).errors[0]).toMatch(/"gesture" needs "focus"/)
    expect(parse({ focus: [0], gesture: 'fall', direction: 'sideways' }).errors[0]).toMatch(
      /"direction" must be one of/,
    )
    expect(parse({ focus: [0], direction: 'left' }).errors[0]).toMatch(/needs a "gesture"/)
  })

  it('rejects unknown line fields so no lyric text can enter the file', () => {
    const { errors } = parse({ words: ['smuggled', 'text'] })
    expect(errors[0]).toMatch(/unknown field "words"/)
    expect(parse({ text: 'nope' }).errors[0]).toMatch(/unknown field "text"/)
  })

  it('rejects a bad version', () => {
    const { errors } = parseSemantics({ ...base, version: 3 })
    expect(errors[0]).toMatch(/"version" must be 1 or 2/)
  })
})

describe('validateFocusRanges', () => {
  const { semantics } = parseSemantics({
    sections: [
      {
        start: 0,
        end: 10,
        label: 'a',
        energy: 0.5,
        mood: 'calm',
        palette: ['#000000', '#111111', '#222222'],
        imagery: [],
      },
    ],
    version: 2,
    lines: [
      { time: 1, emphasis: 0.5, focus: [0, 3] },
      { time: 5, emphasis: 0.5, focus: [1] },
    ],
  })

  it('passes in-range indices and flags out-of-range ones', () => {
    const ok = validateFocusRanges(semantics!, [
      { time: 1, wordCount: 4 },
      { time: 5, wordCount: 2 },
    ])
    expect(ok).toEqual([])
    const bad = validateFocusRanges(semantics!, [
      { time: 1, wordCount: 3 },
      { time: 5, wordCount: 2 },
    ])
    expect(bad).toHaveLength(1)
    expect(bad[0]).toMatch(/focus index 3 out of range/)
  })

  it('flags focus on a line no lyric starts at', () => {
    const missing = validateFocusRanges(semantics!, [{ time: 1, wordCount: 4 }])
    expect(missing[0]).toMatch(/no lyric line starts there/)
  })
})

describe('lineAnnotation', () => {
  it('returns the full line within the time tolerance', () => {
    const { semantics } = parseSemantics({
      sections: [
        {
          start: 0,
          end: 10,
          label: 'a',
          energy: 0.5,
          mood: 'calm',
          palette: ['#000000', '#111111', '#222222'],
          imagery: [],
        },
      ],
      lines: [{ time: 1, emphasis: 0.9, focus: [0] }],
    })
    expect(lineAnnotation(semantics!, 1.02)?.focus).toEqual([0])
    expect(lineAnnotation(semantics!, 2)).toBeNull()
    expect(lineAnnotation(semantics!, null)).toBeNull()
  })
})

describe('activeSectionIndex', () => {
  const { semantics } = parseSemantics(fixture())
  const sections = semantics!.sections

  it('finds the containing section and -1 outside', () => {
    expect(activeSectionIndex(sections, 0)).toBe(0)
    const last = sections[sections.length - 1]
    expect(activeSectionIndex(sections, last.start + 0.01)).toBe(sections.length - 1)
    expect(activeSectionIndex(sections, last.end + 10)).toBe(-1)
  })

  it('treats end as exclusive / start as inclusive', () => {
    const b = sections[1]
    expect(activeSectionIndex(sections, b.start)).toBe(1)
    expect(activeSectionIndex(sections, b.start - 0.01)).toBe(0)
  })
})

describe('emphasisAt', () => {
  const { semantics } = parseSemantics(fixture())

  it('matches a listed line time and defaults otherwise', () => {
    const line = semantics!.lines[0]
    expect(emphasisAt(semantics!, line.time)).toBe(line.emphasis)
    expect(emphasisAt(semantics!, line.time + 1)).toBe(DEFAULT_EMPHASIS)
    expect(emphasisAt(semantics!, null)).toBe(DEFAULT_EMPHASIS)
  })
})
