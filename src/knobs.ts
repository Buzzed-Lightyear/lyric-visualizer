/**
 * A Tweakpane panel over every numeric constant in src/tuning.ts,
 * toggled with K. Edits mutate the tuning objects directly, so the
 * running scene picks them up on the next frame. Nothing is persisted:
 * copy values you like into src/tuning.ts (the "log values" button
 * prints them all to the console).
 */

import { Pane } from 'tweakpane'
import * as TUNING from './tuning'

const GROUPS: Record<string, Record<string, unknown>> = {
  analysis: TUNING.ANALYSIS,
  beat: TUNING.BEAT,
  text: TUNING.TEXT,
  legibility: TUNING.LEGIBILITY,
  butterchurn: TUNING.BUTTERCHURN,
  'behavior: slam': TUNING.BEHAVIOR.slam,
  'behavior: drop': TUNING.BEHAVIOR.drop,
  'behavior: float': TUNING.BEHAVIOR.float,
  'behavior: tremble': TUNING.BEHAVIOR.tremble,
  'behavior: swing': TUNING.BEHAVIOR.swing,
  'behavior: shatter': TUNING.BEHAVIOR.shatter,
  'scene / drift': TUNING.SCENE,
  trail: TUNING.TRAIL,
  background: TUNING.BG,
  embers: TUNING.EMBERS,
  rain: TUNING.RAIN,
  stars: TUNING.STARS,
  haze: TUNING.HAZE,
  transition: TUNING.TRANSITION,
  emphasis: TUNING.EMPHASIS,
  mapping: TUNING.MAPPING,
}

/** Applied at graph/renderer construction; changing them live is a no-op. */
const SKIP = new Set([
  'fftSize',
  'analyserSmoothing',
  'count',
  'blobCount',
  'lightCount',
  'particleCount',
  'points',
  'substep',
])

export interface Knobs {
  toggle(): void
  dispose(): void
}

export function createKnobs(): Knobs {
  const pane = new Pane({ title: 'tuning (K)' })
  pane.hidden = true
  for (const [name, group] of Object.entries(GROUPS)) {
    const folder = pane.addFolder({ title: name, expanded: false })
    for (const [key, value] of Object.entries(group)) {
      if (SKIP.has(key) || typeof value !== 'number') continue
      const span = value === 0 ? 1 : Math.abs(value) * 4
      folder.addBinding(group as Record<string, number>, key, {
        min: value < 0 ? -span : 0,
        max: span,
        step: span / 400,
      })
    }
  }
  pane
    .addButton({ title: 'log values to console' })
    .on('click', () => console.log(JSON.stringify(TUNING, null, 2)))
  return {
    toggle: () => {
      pane.hidden = !pane.hidden
    },
    dispose: () => pane.dispose(),
  }
}
