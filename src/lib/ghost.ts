import { lerp, projectOnSegment } from './geo';
import type { LatLon, TrackPoint } from './types';

export interface GhostState {
  /** Current stopwatch minus the reference's stopwatch at the same place (negative = ahead). */
  delta: number | null;
  offRoute: boolean;
  /** Progress along the reference, 0..1. */
  progress: number;
  /** Predicted finish time if the gap holds. */
  predicted: number | null;
}

/**
 * Races the live position against a reference run ("ghost"). Each update map-matches the current
 * position onto the reference track, searching a forward window from the last match so that loops and
 * out-and-back routes resolve to the right place.
 */
export class Ghost {
  private lastIdx = 0;
  private lastDelta: number | null = null;
  readonly total: number;
  readonly totalDist: number;

  constructor(
    private readonly ref: TrackPoint[],
    private readonly radius = 80,
  ) {
    this.total = ref.length ? ref[ref.length - 1].e : 0;
    this.totalDist = ref.length ? ref[ref.length - 1].d : 0;
  }

  reset(): void {
    this.lastIdx = 0;
    this.lastDelta = null;
  }

  private search(p: LatLon, from: number, to: number): { i: number; t: number; dist: number } | null {
    let best: { i: number; t: number; dist: number } | null = null;
    for (let i = from; i < to; i++) {
      const pr = projectOnSegment(p, this.ref[i], this.ref[i + 1]);
      if (pr.dist <= this.radius && (!best || pr.dist < best.dist - 0.5)) best = { i, t: pr.t, dist: pr.dist };
    }
    return best;
  }

  update(p: LatLon, elapsed: number): GhostState {
    const n = this.ref.length;
    if (n < 2) return { delta: null, offRoute: true, progress: 0, predicted: null };
    const from = Math.max(0, this.lastIdx - 2);
    let m = this.search(p, from, Math.min(n - 1, this.lastIdx + 90));
    if (!m) m = this.search(p, from, n - 1);
    if (!m) {
      return {
        delta: this.lastDelta,
        offRoute: true,
        progress: this.totalDist ? this.ref[this.lastIdx].d / this.totalDist : 0,
        predicted: null,
      };
    }
    this.lastIdx = m.i;
    const a = this.ref[m.i];
    const b = this.ref[m.i + 1];
    const refE = lerp(a.e, b.e, m.t);
    const refD = lerp(a.d, b.d, m.t);
    const delta = elapsed - refE;
    this.lastDelta = delta;
    return {
      delta,
      offRoute: false,
      progress: this.totalDist ? refD / this.totalDist : 0,
      predicted: this.total + delta,
    };
  }
}
