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
  /** Measurement slack for the text legibility rules (src/tuning.ts LEGIBILITY). */
  legibilityEpsPx: 2,
  legibilityEpsDeg: 0.5,
  /** The debug overlay must render identically on a polluted context
   * (max per-channel pixel difference). */
  debugOverlayMaxDiff: 0,
  /** Type specimen: word gaps must match the voice's word space (px). */
  wordGapEpsPx: 1.5,
  /** ...slots must stay inside the safe margins (px of slack). */
  marginEpsPx: 2,
  /** ...wrapped rows must be balanced: narrowest / widest at least this. */
  rowBalanceMin: 0.45,
  /** Butterchurn smoke: minimum luminance stddev of a rendered frame. */
  butterchurnMinStdDev: 2,
  /**
   * Tagging control presets: max mean-absolute-deviation from the
   * cross-batch median, per axis, for batches to count as agreeing.
   */
  controlAxisMad: 0.15,
} as const
