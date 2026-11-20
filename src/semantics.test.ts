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

// A made-up document with the shape the structural tests below need.
const fixture = (): unknown => ({
  version: 2,
  sections: [0, 8, 16, 24].map((start, i) => ({
    start,
    end: start + 8,
    label: `part ${i + 1}`,
    energy: 0.5,
    mood: 'calm',
    palette: ['#000000', '#111111', '#222222'],
    imagery: [],
  })),
  lines: [
    { time: 1.5, emphasis: 0.8, focus: [0] },
    { time: 9, emphasis: 0.4 },
  ],
})

describe('parseSemantics', () => {
  it('accepts the made-up fixture', () => {
    const { semantics, errors } = parseSemantics(fixture())
    expect(errors).toEqual([])
    expect(semantics).not.toBeNull()
    expect(semantics!.sections.length).toBeGreaterThan(3)
  })

  it('accepts every committed semantics file in the library', () => {
    const songsDir = new URL('../public/songs', import.meta.url)
    if (!fs.existsSync(songsDir)) return
    for (const name of fs.readdirSync(songsDir)) {
      const file = new URL(`../public/songs/${name}/semantics.json`, import.meta.url)
      if (!fs.existsSync(file)) continue
      const { semantics, errors } = parseSemantics(JSON.parse(fs.readFileSync(file, 'utf8')))
      expect(errors, `${name}/semantics.json`).toEqual([])
      expect(semantics).not.toBeNull()
    }
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
    const { errors } = parseSemantics({ ...base, version: 4 })
    expect(errors[0]).toMatch(/"version" must be 1, 2 or 3/)
  })
})

// A made-up version 3 document: free mood and imagery, axes, scene, voice, a look.
const v3Section = (over: Record<string, unknown> = {}) => ({
  start: 0,
  end: 10,
  label: 'verse',
  energy: 0.4,
  mood: 'sun-drunk, unhurried',
  axes: { arousal: 0.3, valence: 0.7, tension: 0.2, warmth: 0.8 },
  palette: ['#1a1206', '#e0a040', '#f4e2b8'],
  imagery: ['paper lanterns', 'warm dust'],
  scene: 'Lanterns sway over an empty courtyard at dusk.',
  voice: 'main',
  ...over,
})

const v3Look = (over: Record<string, unknown> = {}) => ({
  description: 'A slow amber evening that never quite turns to night.',
  palette: ['#1a1206', '#e0a040', '#f4e2b8', '#7a3b1e'],
  voices: { main: 'serif', accent: 'marker' },
  presets: { verse: 'some preset name' },
  ...over,
})

const v3Doc = (over: Record<string, unknown> = {}) => ({
  version: 3,
  look: v3Look(),
  sections: [v3Section()],
  lines: [{ time: 1, emphasis: 0.5 }],
  ...over,
})

describe('version 3', () => {
  it('parses the look and the per-section fields', () => {
    const { semantics, errors } = parseSemantics(v3Doc())
    expect(errors).toEqual([])
    expect(semantics!.look).toEqual({
      description: 'A slow amber evening that never quite turns to night.',
      palette: ['#1a1206', '#e0a040', '#f4e2b8', '#7a3b1e'],
      voices: { main: 'serif', accent: 'marker' },
      presets: { verse: 'some preset name' },
    })
    const section = semantics!.sections[0]
    expect(section.mood).toBe('sun-drunk, unhurried')
    expect(section.axes).toEqual({ arousal: 0.3, valence: 0.7, tension: 0.2, warmth: 0.8 })
    expect(section.scene).toMatch(/Lanterns/)
    expect(section.voice).toBe('main')
  })

  it('accepts any mood words and imagery tags: there is no list', () => {
    const doc = v3Doc({
      sections: [v3Section({ mood: 'zorblax', imagery: ['a thing nobody listed'] })],
    })
    expect(parseSemantics(doc).errors).toEqual([])
  })

  it('needs a look, and a look needs version 3', () => {
    const { look: _look, ...noLook } = v3Doc()
    expect(parseSemantics(noLook).errors.join(' ')).toMatch(/version 3 needs a "look"/)
    expect(parseSemantics({ ...(fixture() as object), look: v3Look() }).errors.join(' ')).toMatch(
      /"look" needs "version": 3/,
    )
  })

  it('holds the look to its shape', () => {
    const bad = (look: Record<string, unknown>) =>
      parseSemantics(v3Doc({ look: v3Look(look) })).errors.join(' | ')
    expect(bad({ description: '' })).toMatch(/"description" must be 1-3 sentences/)
    expect(bad({ description: 'x'.repeat(401) })).toMatch(/at most 400 characters/)
    expect(bad({ palette: ['#000000', 'red', '#ffffff'] })).toMatch(/"palette" must be 3-6 hex/)
    expect(bad({ voices: { main: 'serif', accent: 'comic-sans' } })).toMatch(/each one of block, air/)
    expect(bad({ voices: { main: 'serif', accent: 'serif' } })).toMatch(/two different voices/)
    expect(bad({ presets: { 'not a label': 'x' } })).toMatch(/not a section label/)
    expect(bad({ presets: { verse: 7 } })).toMatch(/must be a preset name/)
    expect(bad({ presetsFrom: 'vibes' })).toMatch(/"presetsFrom" must be/)
    expect(bad({ lyrics: 'smuggled text' })).toMatch(/unknown field "lyrics"/)
  })

  it('records whether the image review ran', () => {
    const ok = parseSemantics(v3Doc({ look: v3Look({ review: { ran: true, swapped: ['verse'] } }) }))
    expect(ok.errors).toEqual([])
    expect(ok.semantics!.look!.review).toEqual({ ran: true, swapped: ['verse'] })
    expect(parseSemantics(v3Doc({ look: v3Look({ review: { ran: false, swapped: [] } }) })).errors).toEqual([])
    const bad = (review: unknown) =>
      parseSemantics(v3Doc({ look: v3Look({ review }) })).errors.join(' | ')
    expect(bad({ ran: 'yes', swapped: [] })).toMatch(/"review" must be/)
    expect(bad({ ran: true })).toMatch(/"review" must be/)
    expect(bad({ ran: true, swapped: [], notes: 'free text' })).toMatch(/"review" must be/)
    expect(bad({ ran: true, swapped: ['bridge'] })).toMatch(/not a section label/)
  })

  it('holds each section to its version 3 fields', () => {
    const bad = (over: Record<string, unknown>) =>
      parseSemantics(v3Doc({ sections: [v3Section(over)] })).errors.join(' | ')
    expect(bad({ axes: undefined })).toMatch(/"axes" must be \{ arousal, valence, tension, warmth \}/)
    expect(bad({ axes: { arousal: 1.2, valence: 0.5, tension: 0.5, warmth: 0.5 } })).toMatch(/each 0\.\.1/)
    expect(bad({ axes: { arousal: 0.5, valence: 0.5, tension: 0.5 } })).toMatch(/"axes"/)
    expect(bad({ scene: undefined })).toMatch(/"scene" must be one line/)
    expect(bad({ scene: 'x'.repeat(161) })).toMatch(/at most 160 characters/)
    expect(bad({ voice: 'loud' })).toMatch(/"voice" must be "main" or "accent"/)
    expect(bad({ mood: 'm'.repeat(49) })).toMatch(/at most 48 characters/)
    expect(bad({ imagery: Array.from({ length: 7 }, (_, i) => `tag ${i}`) })).toMatch(/at most 6 tags/)
    expect(bad({ words: ['smuggled'] })).toMatch(/unknown field "words"/)
  })

  it('lets a partial look sit on version 2 shaped sections', () => {
    const v2Shaped = { start: 0, end: 10, label: 'verse', energy: 0.4, mood: 'calm', palette: ['#000000', '#111111', '#222222'], imagery: ['stars'] }
    const partial = parseSemantics(v3Doc({ look: v3Look({ partial: true, source: 'agent' }), sections: [v2Shaped] }))
    expect(partial.errors).toEqual([])
    expect(partial.semantics!.look!.partial).toBe(true)
    expect(partial.semantics!.look!.source).toBe('agent')
    expect(partial.semantics!.sections[0].axes).toBeUndefined()
    // Without the partial mark the same file is incomplete.
    expect(parseSemantics(v3Doc({ sections: [v2Shaped] })).errors.join(' ')).toMatch(/"axes"/)
  })
})

describe('version 2 compatibility', () => {
  it('parses a version 2 file to exactly the shape it always had', () => {
    const { semantics, errors } = parseSemantics(fixture())
    expect(errors).toEqual([])
    expect(Object.keys(semantics!)).toEqual(['sections', 'lines'])
    expect(semantics!.look).toBeUndefined()
    expect(Object.keys(semantics!.sections[0])).toEqual([
      'start', 'end', 'label', 'energy', 'mood', 'palette', 'imagery',
    ])
  })

  it('never reads version 3 fields out of an older file', () => {
    const doc = fixture() as { sections: Record<string, unknown>[] }
    doc.sections[0].axes = { arousal: 1, valence: 1, tension: 1, warmth: 1 }
    doc.sections[0].scene = 'ignored'
    doc.sections[0].voice = 'accent'
    const { semantics, errors } = parseSemantics(doc)
    expect(errors).toEqual([])
    expect(semantics!.sections[0].axes).toBeUndefined()
    expect(semantics!.sections[0].scene).toBeUndefined()
    expect(semantics!.sections[0].voice).toBeUndefined()
  })

  it('still takes long mood strings and many tags in older files', () => {
    const doc = fixture() as { sections: Record<string, unknown>[] }
    doc.sections[0].mood = 'm'.repeat(80)
    doc.sections[0].imagery = Array.from({ length: 9 }, (_, i) => `tag-${i}`)
    expect(parseSemantics(doc).errors).toEqual([])
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
