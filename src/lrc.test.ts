import { describe, expect, it } from 'vitest'
import { activeLineIndex, parseLrc } from './lrc'

describe('parseLrc', () => {
  it('parses line-timed LRC into sorted seconds', () => {
    const lines = parseLrc('[00:10.50] second\n[00:05.45] first\n[01:02.3] third')
    expect(lines).toEqual([
      { time: 5.45, text: 'first' },
      { time: 10.5, text: 'second' },
      { time: 62.3, text: 'third' },
    ])
  })

  it('keeps empty text as an instrumental gap', () => {
    expect(parseLrc('[00:30.00] ')).toEqual([{ time: 30, text: '' }])
  })

  it('expands multiple time tags on one line', () => {
    const lines = parseLrc('[00:01.00][00:03.00] la')
    expect(lines).toEqual([
      { time: 1, text: 'la' },
      { time: 3, text: 'la' },
    ])
  })

  it('skips metadata and untimed lines', () => {
    expect(parseLrc('[ar: Artist]\nno timestamp here\n[ti: Title]')).toEqual([])
  })

  it('applies the [offset:] tag (positive shows lines sooner)', () => {
    const lines = parseLrc('[offset: +500]\n[00:10.00] x')
    expect(lines).toEqual([{ time: 9.5, text: 'x' }])
  })
})

describe('activeLineIndex', () => {
  const lines = parseLrc('[00:05.00] a\n[00:10.00] b\n[00:20.00] c')

  it('is -1 before the first line and on empty input', () => {
    expect(activeLineIndex(lines, 0)).toBe(-1)
    expect(activeLineIndex([], 99)).toBe(-1)
  })

  it('finds the last line at or before the time', () => {
    expect(activeLineIndex(lines, 5)).toBe(0)
    expect(activeLineIndex(lines, 9.99)).toBe(0)
    expect(activeLineIndex(lines, 10)).toBe(1)
    expect(activeLineIndex(lines, 1000)).toBe(2)
  })
})
