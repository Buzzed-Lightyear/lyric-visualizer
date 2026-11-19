/**
 * Motion behaviors for kinetic typography. Each is a small set of spring
 * constants, entrance state, per-frame forces, a beat response and an
 * exit. Audio drives all ongoing motion: beat = impulse, bass = shake
 * and scale pulse, level = overall energy. Apart from its entrance at
 * the (estimated) word onset, nothing moves on semantics alone.
 */

import type { AudioFrame } from './audioMath'
import type { Random } from './random'
import type { Body, Floor, Forces, SpringConfig } from './springs'
import { BEHAVIOR, TEXT } from './tuning'

export type BehaviorName = 'slam' | 'drop' | 'float' | 'tremble' | 'swing'

export const BEHAVIOR_NAMES: BehaviorName[] = ['slam', 'drop', 'float', 'tremble', 'swing']

export interface ExitMotion {
  /** Vertical acceleration in window fractions/s^2; negative rises. */
  gravity: number
  spin: number
  vx: number
  vy: number
}

export interface Behavior {
  spring(): SpringConfig
  /** Set the body's state at the word's onset. Scale > 1 reads as depth. */
  enter(b: Body, slotX: number, slotY: number, rng: Random, strength: number): void
  /** Continuous accelerations for this frame (constant over substeps). */
  forces(out: Forces, frame: AudioFrame, time: number, phase: number, strength: number): void
  /** Velocity impulse on a beat onset. */
  onBeat(b: Body, rng: Random, strength: number): void
  /** The floor, for behaviors that rest on one. */
  floor?(slotY: number): Floor
  exit(rng: Random, strength: number): ExitMotion
}

export const BEHAVIORS: Record<BehaviorName, Behavior> = {
  /** Flies in from depth with overshoot; beats jolt it. */
  slam: {
    spring: () => ({
      k: BEHAVIOR.slam.k,
      c: BEHAVIOR.slam.c,
      kRot: BEHAVIOR.slam.kRot,
      cRot: BEHAVIOR.slam.cRot,
      kScale: BEHAVIOR.slam.kScale,
      cScale: BEHAVIOR.slam.cScale,
    }),
    enter(b, x, y, rng, strength) {
      b.x = x + (rng() - 0.5) * 0.05
      b.y = y + (rng() - 0.5) * 0.03
      b.scale = BEHAVIOR.slam.enterScale * (0.8 + 0.4 * strength)
      b.vscale = -2
      b.rot = (rng() - 0.5) * 0.5
    },
    forces(out) {
      out.ax = 0
      out.ay = 0
      out.aRot = 0
      out.aScale = 0
    },
    onBeat(b, rng, strength) {
      b.vx += (rng() - 0.5) * 2 * BEHAVIOR.slam.jolt * strength
      b.vy += (rng() - 0.5) * 2 * BEHAVIOR.slam.jolt * strength
      b.vrot += (rng() - 0.5) * 2 * BEHAVIOR.slam.joltRot * strength
      b.vscale += BEHAVIOR.slam.joltScale * strength
    },
    exit: (rng, strength) => ({
      gravity: BEHAVIOR.slam.exitGravity,
      spin: (rng() - 0.5) * 4,
      vx: (rng() - 0.5) * 0.3 * strength,
      vy: -0.1 * strength,
    }),
  },

  /** Falls under gravity, bounces on a floor line at the slot, settles. */
  drop: {
    spring: () => ({
      k: BEHAVIOR.drop.k,
      c: BEHAVIOR.drop.c,
      kRot: BEHAVIOR.drop.kRot,
      cRot: BEHAVIOR.drop.cRot,
      kScale: 70,
      cScale: 11,
    }),
    enter(b, x, y, rng, strength) {
      b.x = x
      b.y = y - BEHAVIOR.drop.dropHeight * (0.7 + 0.6 * strength)
      b.vy = 0
      b.rot = (rng() - 0.5) * 0.12
    },
    forces(out) {
      out.ax = 0
      out.ay = BEHAVIOR.drop.gravity
      out.aRot = 0
      out.aScale = 0
    },
    onBeat(b, rng, strength) {
      b.vy -= BEHAVIOR.drop.hop * strength * (0.5 + rng() * 0.5)
    },
    floor: (slotY) => ({ y: slotY, restitution: BEHAVIOR.drop.restitution }),
    exit: (rng) => ({
      gravity: BEHAVIOR.drop.exitGravity,
      spin: (rng() - 0.5) * 3,
      vx: (rng() - 0.5) * 0.1,
      vy: 0.05,
    }),
  },

  /** Buoyant rise, weak springs, bobs on bass. */
  float: {
    spring: () => ({
      k: BEHAVIOR.float.k,
      c: BEHAVIOR.float.c,
      kRot: BEHAVIOR.float.kRot,
      cRot: BEHAVIOR.float.cRot,
      kScale: 50,
      cScale: 10,
    }),
    enter(b, x, y, rng, strength) {
      b.x = x + (rng() - 0.5) * 0.04
      b.y = y + 0.12 + 0.08 * strength
      b.vy = -0.12 * strength
      b.scale = 0.9
    },
    forces(out, frame, time, phase) {
      out.ax = Math.sin(time * BEHAVIOR.float.bobRate * 0.7 + phase * 2) * BEHAVIOR.float.bobAmp * 0.3
      out.ay =
        -BEHAVIOR.float.buoyancy +
        Math.sin(time * BEHAVIOR.float.bobRate + phase) * BEHAVIOR.float.bobAmp * frame.bass
      out.aRot = Math.sin(time * 0.9 + phase) * 0.15
      out.aScale = 0
    },
    onBeat(b, rng, strength) {
      b.vy -= BEHAVIOR.float.beatLift * strength * (0.5 + rng() * 0.5)
    },
    exit: (rng) => ({
      gravity: -BEHAVIOR.float.exitRise,
      spin: (rng() - 0.5) * 1.5,
      vx: (rng() - 0.5) * 0.08,
      vy: -0.06,
    }),
  },

  /** Tight springs, noise force scaled by mid and high. */
  tremble: {
    spring: () => ({
      k: BEHAVIOR.tremble.k,
      c: BEHAVIOR.tremble.c,
      kRot: BEHAVIOR.tremble.kRot,
      cRot: BEHAVIOR.tremble.cRot,
      kScale: 120,
      cScale: 14,
    }),
    enter(b, x, y, rng) {
      b.x = x
      b.y = y + 0.04
      b.scale = 0.7
      b.rot = (rng() - 0.5) * 0.1
    },
    forces(out, frame, time, phase) {
      const drive = (frame.mid * 0.6 + frame.high * 0.6) * BEHAVIOR.tremble.noise
      // Deterministic pseudo-noise from incommensurate sines.
      out.ax = Math.sin(time * BEHAVIOR.tremble.noiseRate + phase * 11) * drive
      out.ay = Math.sin(time * BEHAVIOR.tremble.noiseRate * 1.31 + phase * 7) * drive
      out.aRot = Math.sin(time * BEHAVIOR.tremble.noiseRate * 0.77 + phase * 5) * drive * 6
      out.aScale = 0
    },
    onBeat(b, rng, strength) {
      b.vx += (rng() - 0.5) * 0.06 * strength
      b.vscale += 0.6 * strength
    },
    exit: (rng) => ({
      gravity: 2,
      spin: (rng() - 0.5) * 5,
      vx: (rng() - 0.5) * 0.15,
      vy: 0,
    }),
  },

  /** Words hang from a pivot and swing like pendulums; beats push them. */
  swing: {
    spring: () => ({
      k: BEHAVIOR.swing.k,
      c: BEHAVIOR.swing.c,
      kRot: BEHAVIOR.swing.kRot,
      cRot: BEHAVIOR.swing.cRot,
      kScale: 70,
      cScale: 11,
    }),
    enter(b, x, y, rng, strength) {
      b.x = x
      b.y = y - 0.06
      b.rot = (rng() - 0.5) * BEHAVIOR.swing.enterTilt * (0.7 + 0.6 * strength)
      b.vrot = 0
    },
    forces(out, frame, time, phase) {
      out.ax = 0
      out.ay = 0
      // A touch of driven sway so idle pendulums keep a pulse.
      out.aRot = Math.sin(time * 1.1 + phase) * 0.12 * (0.3 + frame.level)
      out.aScale = 0
    },
    onBeat(b, rng, strength) {
      b.vrot += (rng() < 0.5 ? -1 : 1) * BEHAVIOR.swing.push * strength
    },
    exit: (rng) => ({
      gravity: 2.2,
      spin: (rng() - 0.5) * 6,
      vx: (rng() - 0.5) * 0.12,
      vy: 0.02,
    }),
  },
}

/** Shared per-frame forces: bass shakes every behavior a little. */
export function sharedForces(out: Forces, frame: AudioFrame, time: number, phase: number): void {
  out.ax += Math.sin(time * TEXT.bassShakeRate + phase * 3) * frame.bass * TEXT.bassShake
  out.ay += Math.sin(time * TEXT.bassShakeRate * 0.83 + phase * 5) * frame.bass * TEXT.bassShake * 0.6
}
