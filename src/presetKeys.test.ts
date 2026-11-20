import { describe, expect, it } from 'vitest'
import {
  clearKept,
  dropPreviewsOf,
  keepPreset,
  newPreviewState,
  playingPreset,
  stepPreview,
} from './presetKeys'
import type { FeedbackFile, LabelPick } from './presetPick'

const pick = (label: string, names: string[], chosen = names[0]): LabelPick => ({
  label,
  candidates: names.map((name, i) => ({ name, score: 1 - i * 0.1, reasons: [] })),
  chosen,
  source: 'look',
  fromFeedback: false,
  reasons: [],
  runnerUp: names[1] ?? null,
})

const file = (): FeedbackFile => ({ version: 2, songs: {}, banned: ['banned one'] })
const anyUsable = () => true

describe('[ and ] preview', () => {
  it('steps through the candidates and says it is not saved', () => {
    const state = newPreviewState()
    const verse = pick('verse 1', ['a', 'b', 'c'])
    expect(stepPreview(verse, state, 1)).toEqual({
      name: 'b',
      message: 'Previewing 2 of 3, not saved. P to keep.',
    })
    expect(stepPreview(verse, state, 1)!.name).toBe('c')
    expect(stepPreview(verse, state, 1)).toEqual({
      name: 'a',
      message: 'Previewing 1 of 3, not saved. P to keep.',
    })
    expect(stepPreview(verse, state, -1)!.message).toBe('Previewing 3 of 3, not saved. P to keep.')
  })

  it('writes nothing to the feedback file', () => {
    const state = newPreviewState()
    const feedback = file()
    const before = JSON.stringify(feedback)
    stepPreview(pick('verse 1', ['a', 'b', 'c']), state, 1)
    stepPreview(pick('chorus', ['x', 'y']), state, -1)
    expect(JSON.stringify(feedback)).toBe(before)
  })

  it('plays the preview for that label until the state is thrown away', () => {
    const state = newPreviewState()
    const verse = pick('verse 1', ['a', 'b', 'c'])
    const chorus = pick('chorus', ['x', 'y'])
    expect(playingPreset(verse, state)).toBe('a')
    stepPreview(verse, state, 1)
    expect(playingPreset(verse, state)).toBe('b')
    expect(playingPreset(chorus, state)).toBe('x') // other labels untouched
    // Reloading the song makes a fresh state: the preview is gone.
    expect(playingPreset(verse, newPreviewState())).toBe('a')
  })

  it('starts from whatever is playing, not from the top of the list', () => {
    const state = newPreviewState()
    const verse = pick('verse 1', ['a', 'b', 'c'], 'b') // the pick sits second
    expect(stepPreview(verse, state, 1)!.name).toBe('c')
  })

  it('does nothing for a label without candidates', () => {
    expect(stepPreview(pick('verse 1', []), newPreviewState(), 1)).toBeNull()
    expect(stepPreview(undefined, newPreviewState(), 1)).toBeNull()
    expect(playingPreset(undefined, newPreviewState())).toBeNull()
  })
})

describe('P keeps', () => {
  it('saves the preset on screen for this label in this song only', () => {
    const state = newPreviewState()
    const feedback = file()
    const verse = pick('verse 1', ['a', 'b', 'c'])
    const { name } = stepPreview(verse, state, 1)!
    expect(keepPreset(feedback, 'song-one', 'verse 1', name, state, anyUsable)).toEqual({
      kept: true,
      message: 'Kept for verse 1.',
    })
    expect(feedback.songs).toEqual({ 'song-one': { 'verse 1': 'b' } })
    expect(feedback.banned).toEqual(['banned one'])
    // The preview is over: the kept choice is now the pick's business.
    expect(state.preview.has('verse 1')).toBe(false)
    expect(state.index.has('verse 1')).toBe(false)
  })

  it('keeps the current preset even without a preview', () => {
    const feedback = file()
    keepPreset(feedback, 'song-one', 'chorus', 'x', newPreviewState(), anyUsable)
    expect(feedback.songs['song-one']).toEqual({ chorus: 'x' })
  })

  it('refuses to keep nothing, a banned preset or an unusable one', () => {
    const feedback = file()
    const state = newPreviewState()
    expect(keepPreset(feedback, 's', 'verse 1', null, state, anyUsable).kept).toBe(false)
    const banned = keepPreset(feedback, 's', 'verse 1', 'banned one', state, (name, fb) => !fb.banned.includes(name))
    expect(banned).toEqual({ kept: false, message: 'Nothing to keep: no usable preset on screen.' })
    // The real catalog does not know this name.
    expect(keepPreset(feedback, 's', 'verse 1', 'no such preset', state).kept).toBe(false)
    expect(feedback.songs.s).toEqual({})
  })
})

describe('clearing and banning', () => {
  it("clears one song's kept choices and leaves bans and other songs alone", () => {
    const feedback: FeedbackFile = {
      version: 2,
      songs: { 'song-one': { 'verse 1': 'a', chorus: 'x' }, 'song-two': { intro: 'q' } },
      banned: ['banned one'],
    }
    expect(clearKept(feedback, 'song-one')).toEqual({
      cleared: 2,
      message: 'Cleared 2 kept choices for this song.',
    })
    expect(feedback).toEqual({
      version: 2,
      songs: { 'song-one': {}, 'song-two': { intro: 'q' } },
      banned: ['banned one'],
    })
    expect(clearKept(feedback, 'song-one').message).toBe('No kept choices for this song.')
    expect(clearKept(feedback, 'song-two').message).toBe('Cleared 1 kept choice for this song.')
  })

  it('stops previewing a preset that gets banned', () => {
    const state = newPreviewState()
    stepPreview(pick('verse 1', ['a', 'b']), state, 1)
    stepPreview(pick('chorus', ['x', 'b']), state, 1)
    stepPreview(pick('bridge', ['m', 'n']), state, 1)
    dropPreviewsOf(state, 'b')
    expect([...state.preview.entries()]).toEqual([['bridge', 'n']])
  })
})
