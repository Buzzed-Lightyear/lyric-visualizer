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
} as const

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
} as const

export const SCENE = {
  /** Neutral background; must match the page background (#080a12). */
  backgroundRgb: '8, 10, 18',
  /** Baseline count (the step 2 look); energy scales it up to maxParticles. */
  particleCount: 140,
  maxParticles: 240,
  /** How strongly a mood's lift (-1..1) tilts particle drift vertically. */
  liftBias: 0.035,
  /** Trail fade rate per second; higher = shorter trails. */
  trailFade: 3.5,
  /** Particle drift, as a fraction of the window per second. */
  idleSpeed: 0.012,
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
  glowAlphaBase: 0.1,
  glowAlphaBass: 0.22,
  /** Idle breathing so pause settles into slow motion instead of freezing. */
  breathRate: 0.6,
  breathAmount: 0.015,
  /** Beat accent ring: how far it spreads and how bright it starts. */
  ringSpread: 0.9,
  ringAlpha: 0.3,
} as const

/**
 * Motion character per motif, applied on top of the step 2 baselines.
 * speed/wander/twinkle/width are multipliers; biasY is window-fractions
 * per second (negative rises); streak > 0 draws particles as trails of
 * that many pixels.
 */
export const MOTIFS = {
  drift: { speed: 1, wander: 1, biasY: 0, twinkle: 1, streak: 0, width: 1 },
  embers: { speed: 0.9, wander: 0.8, biasY: -0.06, twinkle: 1.8, streak: 0, width: 1 },
  rain: { speed: 0.5, wander: 0.15, biasY: 0.3, twinkle: 0.4, streak: 10, width: 0.6 },
  stars: { speed: 0.15, wander: 0.5, biasY: 0, twinkle: 2.2, streak: 0, width: 1 },
} as const

export type Motif = keyof typeof MOTIFS

export const MAPPING = {
  /** SceneParams reach ~95% of a section change in 3x this, in seconds. */
  easeTau: 0.5,
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
} as const
