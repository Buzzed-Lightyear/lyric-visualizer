/**
 * The section-change rule, shared by the butterchurn preset switch and
 * the text style: commit on the next beat (or after a short wait), blend
 * fast on an energy rise and slow on a fall. The old scene keeps its own
 * internal copy of this rule for its crossfades.
 */

import { BUTTERCHURN, TRANSITION } from './tuning'

export interface CommitTarget {
  key: string
  energy: number
}

export class SectionCommitter<T extends CommitTarget> {
  value: T
  private pending: T | null = null
  private pendingAge = 0
  private seek = false

  constructor(initial: T) {
    this.value = initial
  }

  notifySeek(): void {
    this.seek = true
  }

  /** Returns the commit (with its blend time) on the frame it happens. */
  update(target: T, beat: number, dt: number): { value: T; blendSec: number } | null {
    if (target.key === this.value.key) {
      this.value = target
      this.pending = null
      this.seek = false
      return null
    }
    if (this.pending?.key === target.key) {
      this.pending = target
      this.pendingAge += dt
    } else {
      this.pending = target
      this.pendingAge = 0
    }
    if (this.seek || beat >= TRANSITION.onsetBeat || this.pendingAge >= TRANSITION.maxWaitSec) {
      const delta = target.energy - this.value.energy
      const blendSec = this.seek
        ? TRANSITION.seekDuration
        : delta > TRANSITION.energyDelta
          ? BUTTERCHURN.blendRise
          : delta < -TRANSITION.energyDelta
            ? BUTTERCHURN.blendFall
            : BUTTERCHURN.blendNormal
      this.value = target
      this.pending = null
      this.seek = false
      return { value: target, blendSec }
    }
    return null
  }
}
