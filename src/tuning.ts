/** Every knob in one place: analysis, beat detection, scene, mapping. */

export const ANALYSIS = {
  fftSize: 2048,
  /** The AnalyserNode's own time smoothing (0..1); channels smooth again on top. */
  analyserSmoothing: 0.5,
  /** Band edges in Hz: [low, high]. `level` spans bass low to high high. */
  bands: {
    bass: [20, 140],
    mid: [140, 2000],
    high: [2000, 9000],
  },
  /** Channel smoothing rates, per second. Higher = snappier. */
  attack: 18,
  release: 5,
  /** Running-peak normalization: how fast the peak forgets, per second. */
  peakDecay: 0.08,
  /** Quietest peak to normalize against, so silence doesn't blow up to 1. */
  peakFloor: 0.06,
}

export const BEAT = {
  /** Fire when raw bass exceeds its running average by this factor. */
  threshold: 1.4,
  /** ...and is at least this loud, so noise in near-silence can't trigger. */
  minBass: 0.05,
  /** No retrigger within this window (0.22s ≈ 270 BPM ceiling). */
  refractorySec: 0.22,
  /** Window of the running bass average the onset is compared against. */
  averageSec: 1.2,
  /** How fast the 0..1 pulse falls after firing, per second. */
  pulseDecay: 5,
}

/** Shared scene baselines; the drift motif IS the step 2 look. */
export const SCENE = {
  /** Neutral background; must match the page background (#080a12). */
  backgroundRgb: '8, 10, 18',
  /** Drift particle count (the step 2 look). */
  particleCount: 140,
  /** Particle drift, as a fraction of the window per second. */
  idleSpeed: 0.016,
  levelSpeed: 0.1,
  /** Direction wander (radians/s of turn): idle floor + what mid adds. */
  wanderRate: 0.9,
  wanderIdle: 0.4,
  wanderMid: 3.2,
  /** Particle brightness: base + level, with high driving the twinkle. */
  particleAlphaBase: 0.18,
  particleAlphaLevel: 0.45,
  particleAlphaHigh: 0.5,
  twinkleRate: 14,
  /** How much a beat momentarily fattens particles. */
  particleBeatSize: 0.6,
  /** Central glow radius, as a fraction of the smaller window side. */
  glowBase: 0.16,
  glowBass: 0.16,
  glowBeat: 0.07,
  glowAlphaBase: 0.45,
  glowAlphaBass: 0.45,
  /** Idle breathing so pause settles into slow motion instead of freezing. */
  breathRate: 0.6,
  breathAmount: 0.015,
  /** Beat accent ring: how far it spreads and how bright it starts. */
  ringSpread: 0.9,
  ringAlpha: 0.3,
  /** How strongly a mood's lift (-1..1) tilts particle drift vertically. */
  liftBias: 0.035,
}

/**
 * Explicit particle trails (drift and embers), drawn from position
 * history. The old canvas-feedback trails pulsed (the fade had to flush
 * in chunks to dodge 8-bit rounding) and ghosted; these do neither.
 */
export const TRAIL = {
  /** History points per particle. */
  points: 8,
  /** Seconds between samples; points * spacing = trail duration. */
  spacingSec: 0.035,
  /** Head alpha of the trail, scaled down along its length. */
  alpha: 0.35,
}

/** Semantic background: gradient + vignette strength (0 for neutral/drift). */
export const BG = {
  /** Top of the gradient: background darkened by this factor. */
  topDarken: 0.45,
  /** Bottom of the gradient: background mixed toward the glow color. */
  bottomGlowMix: 0.16,
  /** Edge darkening; 0 disables the vignette. */
  vignette: 0.5,
}

export const EMBERS = {
  count: 150,
  /** Depth layers: far -> near multipliers. */
  depthSpeed: [0.45, 0.7, 1],
  depthSize: [0.5, 0.75, 1],
  depthAlpha: [0.45, 0.7, 1],
  /** Rise, as a fraction of the window per second, plus what level adds. */
  riseSpeed: 0.05,
  riseLevel: 0.1,
  /** Horizontal sway amplitude (fraction of window) and rate (rad/s). */
  sway: 0.02,
  swayRate: 1.6,
  flickerRate: 9,
  /** Sprite size range in px (scaled by depth). */
  sizeMin: 3,
  sizeMax: 9,
  alphaBase: 0.35,
  alphaLevel: 0.65,
  /** Heat bed along the bottom edge. */
  bedHeight: 0.25,
  bedAlpha: 0.2,
  bedBass: 0.5,
  bedKick: 0.25,
}

export const RAIN = {
  count: 170,
  depthSpeed: [0.5, 0.75, 1],
  depthAlpha: [0.35, 0.6, 0.9],
  depthWidth: [1, 1.4, 1.9],
  /** Tilt from vertical, radians. */
  tilt: 0.16,
  /** Fall, as a fraction of the window height per second, plus level. */
  fallSpeed: 0.5,
  fallLevel: 0.6,
  /** Streak length as a fraction of fall-per-second. */
  lengthFactor: 0.14,
  alphaLevel: 0.35,
  alphaKick: 0.15,
  /** Dim glow high up. */
  topGlowAlpha: 0.1,
  topGlowBass: 0.16,
  topGlowHeight: 0.4,
}

export const STARS = {
  count: 210,
  depthAlpha: [0.4, 0.65, 1],
  depthSize: [0.5, 0.75, 1],
  /** Horizontal parallax, fraction of window per second (near layer). */
  parallax: 0.006,
  /** Twinkle: rate (rad/s) and how much high opens it up. */
  twinkleRate: 2.4,
  twinkleBase: 0.25,
  twinkleHigh: 0.75,
  sizeMin: 1.5,
  sizeMax: 4,
  /** Every nth star is bright (bigger sprite). */
  brightEvery: 11,
  brightSize: 2.2,
  /** Soft glow at the horizon. */
  horizonAlpha: 0.14,
  horizonBass: 0.24,
  horizonKick: 0.2,
  horizonRadius: 0.65,
}

export const HAZE = {
  blobCount: 12,
  /** Blob size range, as fractions of the smaller window side. */
  blobSizeMin: 0.2,
  blobSizeMax: 0.42,
  blobAlpha: 0.16,
  blobLevel: 0.16,
  blobKick: 0.1,
  /** Blob wander speed, fraction of window per second. */
  blobSpeed: 0.008,
  /** Blurred bokeh lights. */
  lightCount: 26,
  lightSizeMin: 0.015,
  lightSizeMax: 0.05,
  lightAlpha: 0.2,
  lightLevel: 0.35,
  lightTwinkle: 0.3,
  twinkleRate: 3,
  lightSpeed: 0.012,
}

/** How a section change commits and crossfades. Audio decides when. */
export const TRANSITION = {
  /** frame.beat at/above this counts as the committing onset. */
  onsetBeat: 0.95,
  /** Commit anyway after this long without a beat. */
  maxWaitSec: 0.4,
  /** |energy delta| above this counts as a rise/fall. */
  energyDelta: 0.15,
  riseDuration: 0.4,
  fallDuration: 2.5,
  normalDuration: 1.2,
  /** After a seek, settle this fast without waiting for a beat. */
  seekDuration: 0.3,
  /** Extra accent injected when a rise commits, and its decay per second. */
  riseKick: 1,
  kickDecay: 4,
}

/**
 * How line emphasis (via params.accent, 1 = neutral) scales the
 * audio-driven response: each is the slope of a (1 + c * (accent - 1))
 * multiplier, so accent 1 is always exactly the step 2 look.
 */
export const EMPHASIS = {
  glow: 0.5,
  size: 0.35,
  /** Cap on the beat kick after accent scaling. */
  kickCap: 1.6,
}

export const MAPPING = {
  /** Energy 0 -> AtZero, energy 1 -> AtFull (multiplied into the baselines). */
  countAtZero: 0.5,
  countAtFull: 1.6,
  speedAtZero: 0.6,
  speedAtFull: 1.4,
  glowAtZero: 0.7,
  glowAtFull: 1.3,
  /** Same idea for line emphasis -> how hard beat accents land. */
  accentAtZero: 0.4,
  accentAtFull: 1.6,
}
