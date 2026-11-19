import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { activeSectionIndex, DEFAULT_EMPHASIS, emphasisAt, parseSemantics } from './semantics'

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
