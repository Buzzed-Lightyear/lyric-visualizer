import { describe, expect, it } from 'vitest'
import { resolvePresetName } from './presetMap'

const NAMES = ['Alpha - One', 'Beta - Two', 'Gamma - Three']
const GUESSES = { furious: 'Beta - Two', weary: 'Not In The Pack' }

describe('resolvePresetName', () => {
  it('prefers a valid pin over the guess', () => {
    expect(resolvePresetName('furious', NAMES, { furious: 'Gamma - Three' }, GUESSES)).toBe(
      'Gamma - Three',
    )
  })

  it('ignores a pin that is not in the pack', () => {
    expect(resolvePresetName('furious', NAMES, { furious: 'Gone - Preset' }, GUESSES)).toBe(
      'Beta - Two',
    )
  })

  it('uses the guess when present in the pack', () => {
    expect(resolvePresetName('Furious', NAMES, {}, GUESSES)).toBe('Beta - Two')
  })

  it('falls back deterministically to a name from the pack', () => {
    const a = resolvePresetName('weary', NAMES, {}, GUESSES)
    const b = resolvePresetName('weary', NAMES, {}, GUESSES)
    expect(a).toBe(b)
    expect(NAMES).toContain(a)
    // An unknown mood also lands somewhere in the pack.
    expect(NAMES).toContain(resolvePresetName('zorblax', NAMES, {}, GUESSES))
  })
})
