/**
 * Every verify threshold in one place. These are the contract `npm run
 * shots` enforces; do not loosen one to make a change pass without
 * flagging it to the owner.
 *
 * "Grid distance" is the mean absolute RGB difference (0..255) between
 * two renders downscaled to a 32x18 grid.
 */
export const THRESHOLDS = {
  /** A tile must have at least this much luminance variation (stddev, 0..255). */
  minTileStdDev: 6,
  /** ...and not be pitch black (mean luminance, 0..255). */
  minTileLuminance: 4,
  /** Two differently labeled sections must be at least this far apart. */
  minSectionDistance: 5,
  /** Repeats of one section (the two choruses) must match this closely. */
  maxSameLabelDistance: 1.5,
  /** Semantics toggled off mid-song must land this close to the neutral look. */
  maxNeutralDistance: 4,
  /**
   * Idle (level 0) inter-frame motion must stay above this (no freezing).
   * Recalibrated 0.02 -> 0.012 when canvas-feedback trails were replaced
   * with explicit ones: the same visible idle motion now smears across
   * fewer pixels, so it reads lower on the grid metric. Flagged to the
   * owner in the step 3 flicker-fix pass.
   */
  idleMotionMin: 0.012,
  /** Motion at level 1 must exceed motion at level 0.35 by this factor. */
  motionRiseFactor: 1.25,
  /** Max single-frame change inside a transition, as a multiple of the
   * busiest steady-state single-frame change. */
  jumpFactor: 3,
  /** Rough per-frame draw budget at 1280x720 DPR 1 in headless Chromium. */
  drawAvgMs: 8,
  drawP99Ms: 30,
} as const
