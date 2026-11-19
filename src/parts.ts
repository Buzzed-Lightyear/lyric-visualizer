/**
 * The animation system: three independent part kinds. An ENTRANCE sets a
 * word's (or its letters') initial state at the onset; a HOLD is the
 * spring and the ongoing audio-driven motion while the line is active; an
 * EXIT is how the line leaves. The original five behaviors are named
 * combinations (COMBOS) of parts with the same constants as before.
 * Audio drives all ongoing motion; semantics choose parts and strengths.
 */

import type { AudioFrame } from './audioMath'
import type { Random } from './random'
import type { Body, Floor, Forces, SpringConfig } from './springs'
import { ENTRANCE_T, EXIT_T, HOLD_T, TEXT } from './tuning'

export type EntranceName =
  | 'slam'
  | 'fall'
  | 'buoy'
  | 'creep'
  | 'hang'
  | 'whip'
  | 'fling'
  | 'pop'
  | 'assemble'
  | 'unfold'
export type HoldName =
  | 'jolt'
  | 'rest'
  | 'bob'
  | 'tremble'
  | 'pendulum'
  | 'pulse'
  | 'wave'
  | 'still'
export type ExitName =
  | 'tumble'
  | 'collapse'
  | 'liftOff'
  | 'blow'
  | 'sink'
  | 'snap'
  | 'knock'
  | 'shatter'

export const ENTRANCE_NAMES: EntranceName[] = [
  'slam', 'fall', 'buoy', 'creep', 'hang', 'whip', 'fling', 'pop', 'assemble', 'unfold',
]
export const HOLD_NAMES: HoldName[] = [
  'jolt', 'rest', 'bob', 'tremble', 'pendulum', 'pulse', 'wave', 'still',
]
export const EXIT_NAMES: ExitName[] = [
  'tumble', 'collapse', 'liftOff', 'blow', 'sink', 'snap', 'knock', 'shatter',
]

// --- entrances ---------------------------------------------------------------

export interface Entrance {
  /** Per-letter bodies animate the entrance (pop, assemble). */
  letterwise?: boolean
  /** Window (s) during which the entrance owns letter mode / deform. */
  duration: number
  init(b: Body, slotX: number, slotY: number, rng: Random, strength: number): void
  /** Extra start delay for letter index i of n (stagger). */
  letterDelay?(index: number, count: number, rng: Random): number
  /** Draw deform during the window: vertical hinge scale (unfold). */
  deform?(tSinceOnset: number): number | null
}

const E = ENTRANCE_T

export const ENTRANCES: Record<EntranceName, Entrance> = {
  /** Flies in from depth with overshoot. */
  slam: {
    duration: 0,
    init(b, x, y, rng, strength) {
      b.x = x + (rng() - 0.5) * E.slam.jitter
      b.y = y + (rng() - 0.5) * E.slam.jitter * 0.6
      b.scale = E.slam.scale * (0.8 + 0.4 * strength)
      b.vscale = E.slam.vScale
      b.rot = (rng() - 0.5) * 0.5
    },
  },
  /** Drops from above (bounces if the hold has a floor). */
  fall: {
    duration: 0,
    init(b, x, y, rng, strength) {
      b.x = x
      b.y = y - E.fall.height * (0.7 + 0.6 * strength)
      b.rot = (rng() - 0.5) * 0.12
    },
  },
  /** Buoyant rise from below. */
  buoy: {
    duration: 0,
    init(b, x, y, rng, strength) {
      b.x = x + (rng() - 0.5) * 0.04
      b.y = y + E.buoy.depth + 0.08 * strength
      b.vy = -E.buoy.lift * strength
      b.scale = 0.9
    },
  },
  /** Small scale-in at the slot. */
  creep: {
    duration: 0,
    init(b, x, y, rng) {
      b.x = x
      b.y = y + E.creep.sink
      b.scale = E.creep.scale
      b.rot = (rng() - 0.5) * 0.1
    },
  },
  /** Tilted drop-in, as if hung. */
  hang: {
    duration: 0,
    init(b, x, y, rng, strength) {
      b.x = x
      b.y = y - E.hang.raise
      b.rot = (rng() - 0.5) * E.hang.tilt * (0.7 + 0.6 * strength)
    },
  },
  /** Shoots in from a side; squash & stretch does the smearing. */
  whip: {
    duration: 0,
    init(b, x, y, rng, strength) {
      const side = rng() < 0.5 ? -1 : 1
      b.x = x + side * E.whip.distance
      b.y = y + (rng() - 0.5) * 0.05
      b.vx = -side * E.whip.speed * (0.7 + 0.6 * strength)
    },
  },
  /** Thrown in on an arc with spin; lands and settles. */
  fling: {
    duration: 0,
    init(b, x, y, rng, strength) {
      const side = rng() < 0.5 ? -1 : 1
      b.x = x - side * E.fling.dx
      b.y = y + E.fling.dy
      b.vx = side * E.fling.vx * (0.7 + 0.6 * strength)
      b.vy = -E.fling.vy * (0.7 + 0.6 * strength)
      b.rot = -side * 0.8
      b.vrot = side * E.fling.spin
    },
  },
  /** Letters scale up from nothing, staggered. */
  pop: {
    letterwise: true,
    duration: E.pop.duration,
    init(b, x, y) {
      b.x = x
      b.y = y
      b.scale = 0.001
      b.vscale = E.pop.vScale
    },
    letterDelay: (index) => index * E.pop.stagger,
  },
  /** Letters fly in from scattered points and lock into the word. */
  assemble: {
    letterwise: true,
    duration: E.assemble.duration,
    init(b, x, y, rng) {
      b.x = x + (rng() - 0.5) * E.assemble.scatter
      b.y = y + (rng() - 0.5) * E.assemble.scatter * 0.7
      b.rot = (rng() - 0.5) * 1.2
      b.scale = 0.8
    },
    letterDelay: (_index, _count, rng) => rng() * E.assemble.maxDelay,
  },
  /** Opens like a hinge on its baseline. */
  unfold: {
    duration: E.unfold.duration,
    init(b, x, y) {
      b.x = x
      b.y = y
    },
    deform(t) {
      const u = Math.max(0, Math.min(1, t / E.unfold.duration))
      return u >= 1 ? null : u * u * (3 - 2 * u)
    },
  },
}

// --- holds -------------------------------------------------------------------

export interface Hold {
  /** Letter bodies stay the animated unit (wave). */
  letterwise?: boolean
  spring(): SpringConfig
  floor?(slotY: number): Floor
  /**
   * Continuous accelerations for this frame; `phase` desynchronizes
   * words, `index` is the letter index (0 for word mode).
   */
  forces(out: Forces, frame: AudioFrame, time: number, phase: number, index: number): void
  onBeat(b: Body, rng: Random, strength: number): void
}

const H = HOLD_T
const spring = (
  t: { k: number; c: number; kRot: number; cRot: number },
  kScale = 90,
  cScale = 12,
): SpringConfig => ({ k: t.k, c: t.c, kRot: t.kRot, cRot: t.cRot, kScale, cScale })

export const HOLDS: Record<HoldName, Hold> = {
  /** Stiff; beats jolt it (the slam hold). */
  jolt: {
    spring: () => spring(H.jolt),
    forces(out) {
      out.ax = 0
    },
    onBeat(b, rng, strength) {
      b.vx += (rng() - 0.5) * 2 * H.jolt.jolt * strength
      b.vy += (rng() - 0.5) * 2 * H.jolt.jolt * strength
      b.vrot += (rng() - 0.5) * 2 * H.jolt.joltRot * strength
      b.vscale += H.jolt.joltScale * strength
    },
  },
  /** Gravity onto a floor at the slot; beats hop (the drop hold). */
  rest: {
    spring: () => spring(H.rest, 70, 11),
    floor: (slotY) => ({ y: slotY, restitution: H.rest.restitution }),
    forces(out) {
      out.ay = H.rest.gravity
    },
    onBeat(b, rng, strength) {
      b.vy -= H.rest.hop * strength * (0.5 + rng() * 0.5)
    },
  },
  /** Weak springs, bass bob (the float hold). */
  bob: {
    spring: () => spring(H.bob, 50, 10),
    forces(out, frame, time, phase) {
      out.ax = Math.sin(time * H.bob.rate * 0.7 + phase * 2) * H.bob.amp * 0.3
      out.ay = -H.bob.buoyancy + Math.sin(time * H.bob.rate + phase) * H.bob.amp * frame.bass
      out.aRot = Math.sin(time * 0.9 + phase) * 0.15
    },
    onBeat(b, rng, strength) {
      b.vy -= H.bob.beatLift * strength * (0.5 + rng() * 0.5)
    },
  },
  /** Tight springs, noise scaled by mid and high. */
  tremble: {
    spring: () => spring(H.tremble, 120, 14),
    forces(out, frame, time, phase) {
      const drive = (frame.mid * 0.6 + frame.high * 0.6) * H.tremble.noise
      out.ax = Math.sin(time * H.tremble.rate + phase * 11) * drive
      out.ay = Math.sin(time * H.tremble.rate * 1.31 + phase * 7) * drive
      out.aRot = Math.sin(time * H.tremble.rate * 0.77 + phase * 5) * drive * 6
    },
    onBeat(b, rng, strength) {
      b.vx += (rng() - 0.5) * 0.06 * strength
      b.vscale += 0.6 * strength
    },
  },
  /** Hangs from a pivot; beats push the swing. */
  pendulum: {
    spring: () => spring(H.pendulum, 70, 11),
    forces(out, frame, time, phase) {
      out.aRot = Math.sin(time * 1.1 + phase) * 0.12 * (0.3 + frame.level)
    },
    onBeat(b, rng, strength) {
      b.vrot += (rng() < 0.5 ? -1 : 1) * H.pendulum.push * strength
    },
  },
  /** Breathes in scale with bass. */
  pulse: {
    spring: () => spring(H.pulse, 40, 9),
    forces(out, frame, time, phase) {
      out.aScale = Math.sin(time * 2.1 + phase) * 0.3 * frame.bass
    },
    onBeat(b, _rng, strength) {
      b.vscale += 1.2 * strength
    },
  },
  /** A ripple travels across the letters, kicked by beats. */
  wave: {
    letterwise: true,
    spring: () => spring(H.wave, 90, 12),
    forces(out, frame, time, _phase, index) {
      const ripple = Math.sin(time * H.wave.speed - index * H.wave.spacing)
      out.ay = ripple * H.wave.amp * (0.25 + frame.level) * H.wave.k
      out.aRot = ripple * 0.6 * frame.mid
    },
    onBeat() {
      // The kick is an amplitude envelope, handled by the text layer.
    },
  },
  /** Nearly motionless. */
  still: {
    spring: () => spring(H.still, 160, 18),
    forces(out) {
      out.ax = 0
    },
    onBeat() {
      // Unmoved.
    },
  },
}

// --- exits -------------------------------------------------------------------

export interface ExitMotion {
  gravity: number
  spin: number
  vx: number
  vy: number
  /** Scale rate per second (negative shrinks). */
  scaleRate: number
  /** Start delay (s) for staggered exits. */
  delay: number
}

export interface Exit {
  /** The line breaks into letters (shatter). */
  letterwise?: boolean
  /** Outgoing words freeze and cut on the next beat (snap). */
  snap?: boolean
  /**
   * Motions per outgoing word. `newSlots` are the incoming line's slot
   * centers in window fractions (for knock).
   */
  begin(
    words: { x: number; y: number }[],
    rng: Random,
    strength: number,
    newSlots: { x: number; y: number }[],
  ): ExitMotion[]
}

const X = EXIT_T
const motion = (over: Partial<ExitMotion>): ExitMotion => ({
  gravity: 0,
  spin: 0,
  vx: 0,
  vy: 0,
  scaleRate: 0,
  delay: 0,
  ...over,
})

export const EXITS: Record<ExitName, Exit> = {
  tumble: {
    begin: (words, rng, strength) =>
      words.map(() =>
        motion({
          gravity: X.tumble.gravity,
          spin: (rng() - 0.5) * X.tumble.spin,
          vx: (rng() - 0.5) * 2 * X.tumble.kick * strength,
          vy: -0.08 * strength,
        }),
      ),
  },
  /** The floor gives way. */
  collapse: {
    begin: (words, rng) =>
      words.map(() =>
        motion({
          gravity: X.collapse.gravity,
          spin: (rng() - 0.5) * 3,
          vx: (rng() - 0.5) * 0.1,
          vy: 0.05,
        }),
      ),
  },
  liftOff: {
    begin: (words, rng) =>
      words.map(() =>
        motion({
          gravity: -X.liftOff.rise,
          spin: (rng() - 0.5) * 1.5,
          vx: (rng() - 0.5) * X.liftOff.drift,
          vy: -0.06,
        }),
      ),
  },
  /** A gust sweeps the words off sideways, staggered. */
  blow: {
    begin: (words, rng, strength) => {
      const side = rng() < 0.5 ? -1 : 1
      return words.map((_, i) =>
        motion({
          vx: side * X.blow.speed * (0.8 + rng() * 0.4) * strength,
          vy: (rng() - 0.5) * X.blow.wobble * 0.2,
          spin: side * (0.5 + rng()) * X.blow.wobble * 4,
          delay: i * X.blow.stagger,
        }),
      )
    },
  },
  /** Collapses toward the line's center and vanishes. */
  sink: {
    begin: (words, rng) => {
      const cx = words.reduce((a, w) => a + w.x, 0) / Math.max(1, words.length)
      const cy = words.reduce((a, w) => a + w.y, 0) / Math.max(1, words.length)
      return words.map((w) =>
        motion({
          vx: (cx - w.x) * X.sink.pull * 2,
          vy: (cy - w.y) * X.sink.pull * 2 + 0.02,
          scaleRate: -X.sink.shrink,
          spin: (rng() - 0.5) * 1.2,
        }),
      )
    },
  },
  /** Hard cut on the next beat (an intended cut). */
  snap: {
    snap: true,
    begin: (words) => words.map(() => motion({})),
  },
  /** The incoming line shoves the outgoing words away from its slots. */
  knock: {
    begin: (words, rng, strength, newSlots) =>
      words.map((w) => {
        let nearest = { x: w.x, y: w.y - 0.1 }
        let best = Infinity
        for (const slot of newSlots) {
          const d = Math.hypot(slot.x - w.x, slot.y - w.y)
          if (d < best) {
            best = d
            nearest = slot
          }
        }
        const away = Math.hypot(w.x - nearest.x, w.y - nearest.y) || 0.03
        const push = X.knock.speed * strength * Math.max(0.35, 1 - best * 2)
        return motion({
          vx: ((w.x - nearest.x) / away) * push + (rng() - 0.5) * 0.05,
          vy: ((w.y - nearest.y) / away) * push - 0.04,
          gravity: X.knock.gravity,
          spin: (rng() - 0.5) * 2.5,
        })
      }),
  },
  shatter: {
    letterwise: true,
    begin: (words) => words.map(() => motion({})),
  },
}

// --- the original five, as combinations --------------------------------------

export type ComboName = 'slam' | 'drop' | 'float' | 'tremble' | 'swing'

export interface Combo {
  entrance: EntranceName
  hold: HoldName
  exit: ExitName
}

export const COMBOS: Record<ComboName, Combo> = {
  slam: { entrance: 'slam', hold: 'jolt', exit: 'tumble' },
  drop: { entrance: 'fall', hold: 'rest', exit: 'collapse' },
  float: { entrance: 'buoy', hold: 'bob', exit: 'liftOff' },
  tremble: { entrance: 'creep', hold: 'tremble', exit: 'tumble' },
  swing: { entrance: 'hang', hold: 'pendulum', exit: 'tumble' },
}

export const COMBO_NAMES = Object.keys(COMBOS) as ComboName[]

/** Shared per-frame forces: bass shakes everything a little. */
export function sharedForces(out: Forces, frame: AudioFrame, time: number, phase: number): void {
  out.ax += Math.sin(time * TEXT.bassShakeRate + phase * 3) * frame.bass * TEXT.bassShake
  out.ay += Math.sin(time * TEXT.bassShakeRate * 0.83 + phase * 5) * frame.bass * TEXT.bassShake * 0.6
}
