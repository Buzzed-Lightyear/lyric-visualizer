/**
 * Auditioning background presets from the keyboard. Pure, so the key
 * behavior is testable without a browser.
 *
 * - [ and ] only PREVIEW the candidates for the current section label.
 *   Nothing is saved; the preview lives in memory and ends when the song
 *   is reloaded.
 * - P KEEPS the preset now on screen for this section label in this
 *   song. Only that writes to src/presetFeedback.json.
 */

import { isUsable, type Feedback, type FeedbackFile, type LabelPick } from './presetPick'

export interface PreviewState {
  /** Section label -> the preset being previewed in this session. */
  preview: Map<string, string>
  /** Section label -> where the [ ] cycle stands in the candidate list. */
  index: Map<string, number>
}

export function newPreviewState(): PreviewState {
  return { preview: new Map(), index: new Map() }
}

/** What plays for a label: the preview if there is one, else the pick. */
export function playingPreset(pick: LabelPick | undefined, state: PreviewState): string | null {
  if (!pick) return null
  return state.preview.get(pick.label) ?? pick.chosen
}

/**
 * One press of ] (dir 1) or [ (dir -1): move to the next candidate and
 * preview it. Returns the preset to show and the message for the toast,
 * or null when the label has no candidates.
 */
export function stepPreview(
  pick: LabelPick | undefined,
  state: PreviewState,
  dir: 1 | -1,
): { name: string; message: string } | null {
  if (!pick || pick.candidates.length === 0) return null
  const n = pick.candidates.length
  const playing = playingPreset(pick, state)
  const current =
    state.index.get(pick.label) ??
    Math.max(0, pick.candidates.findIndex((candidate) => candidate.name === playing))
  const next = (current + dir + n) % n
  const name = pick.candidates[next].name
  state.index.set(pick.label, next)
  state.preview.set(pick.label, name)
  return { name, message: `Previewing ${next + 1} of ${n}, not saved. P to keep.` }
}

/**
 * P: keep `name` for this label in this song. Writes into the feedback
 * file object (the caller persists it) and ends the label's preview.
 */
export function keepPreset(
  file: FeedbackFile,
  slug: string,
  label: string,
  name: string | null,
  state: PreviewState,
  usable: (name: string, feedback: Feedback) => boolean = isUsable,
): { kept: boolean; message: string } {
  file.songs[slug] ??= {}
  const feedback: Feedback = { chosen: file.songs[slug], banned: file.banned }
  if (!name || !usable(name, feedback)) {
    return { kept: false, message: 'Nothing to keep: no usable preset on screen.' }
  }
  file.songs[slug][label] = name
  state.preview.delete(label)
  state.index.delete(label)
  return { kept: true, message: `Kept for ${label}.` }
}

/** The K panel button: forget this song's kept choices. Bans stay. */
export function clearKept(file: FeedbackFile, slug: string): { cleared: number; message: string } {
  const cleared = Object.keys(file.songs[slug] ?? {}).length
  file.songs[slug] = {}
  return {
    cleared,
    message:
      cleared === 0
        ? 'No kept choices for this song.'
        : `Cleared ${cleared} kept choice${cleared === 1 ? '' : 's'} for this song.`,
  }
}

/** A preset was banned: stop previewing it anywhere. */
export function dropPreviewsOf(state: PreviewState, name: string): void {
  for (const [label, preset] of state.preview) {
    if (preset === name) {
      state.preview.delete(label)
      state.index.delete(label)
    }
  }
}
