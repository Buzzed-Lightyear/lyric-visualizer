/**
 * The hand-rolled physics core for kinetic typography: each word is one
 * body tied to a home slot by damped springs on position, rotation and
 * scale. Fixed-substep semi-implicit Euler, stable under the frame dt
 * clamp. Positions are window fractions (0..1), like the scene.
 */

import { PHYSICS } from './tuning'

export interface Body {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vrot: number
  scale: number
  vscale: number
}

export interface Home {
  x: number
  y: number
  rot: number
  scale: number
}

export interface SpringConfig {
  k: number
  c: number
  kRot: number
  cRot: number
  kScale: number
  cScale: number
}

/** External accelerations, held constant across a frame's substeps. */
export interface Forces {
  ax: number
  ay: number
  aRot: number
  aScale: number
}

export interface Floor {
  y: number
  restitution: number
}

export function newBody(x: number, y: number): Body {
  return { x, y, vx: 0, vy: 0, rot: 0, vrot: 0, scale: 1, vscale: 0 }
}

export const ZERO_FORCES: Forces = { ax: 0, ay: 0, aRot: 0, aScale: 0 }

/** One substep of length h. */
function substep(b: Body, home: Home, s: SpringConfig, f: Forces, h: number, floor?: Floor): void {
  b.vx += (s.k * (home.x - b.x) - s.c * b.vx + f.ax) * h
  b.vy += (s.k * (home.y - b.y) - s.c * b.vy + f.ay) * h
  b.x += b.vx * h
  b.y += b.vy * h
  if (floor && b.y > floor.y) {
    b.y = floor.y
    if (b.vy > 0) b.vy = -b.vy * floor.restitution
  }
  b.vrot += (s.kRot * (home.rot - b.rot) - s.cRot * b.vrot + f.aRot) * h
  b.rot += b.vrot * h
  b.vscale += (s.kScale * (home.scale - b.scale) - s.cScale * b.vscale + f.aScale) * h
  b.scale += b.vscale * h
}

/** Advance a body by dt in fixed substeps so large frames stay stable. */
export function advance(
  b: Body,
  home: Home,
  s: SpringConfig,
  f: Forces,
  dt: number,
  floor?: Floor,
): void {
  let remaining = dt
  while (remaining > 1e-9) {
    const h = Math.min(PHYSICS.substep, remaining)
    substep(b, home, s, f, h, floor)
    remaining -= h
  }
}
