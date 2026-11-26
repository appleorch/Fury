import type { Lap, TrackPoint, TripSummaryStats } from './types';

/** Below this speed (m/s, ≈ 3.6 km/h) the car counts as stopped. */
export const STOP_SPEED = 1.0;
/** A stop must last this long (ms) to be counted. */
const MIN_STOP_MS = 3000;

function medianOf3(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

/** Spike-filtered speeds (3-point median). */
export function filteredSpeeds(points: TrackPoint[]): number[] {
  const n = points.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)].spd;
    const b = points[i].spd;
    const c = points[Math.min(n - 1, i + 1)].spd;
    out[i] = medianOf3(a, b, c);
  }
  return out;
}

export function computeSummary(points: TrackPoint[], duration: number, distance: number): TripSummaryStats {
  let movingTime = 0;
  let stoppedTime = 0;
  let movingDist = 0;
  let stops = 0;
  let stopRun = 0;
  let inStop = false;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.s !== b.s) continue;
    const dt = b.e - a.e;
    if (dt <= 0) continue;
    const dd = b.d - a.d;
    const segSpeed = dd / (dt / 1000);
    const stopped = segSpeed < STOP_SPEED && (a.spd + b.spd) / 2 < STOP_SPEED * 1.5;
    if (stopped) {
      stoppedTime += dt;
      stopRun += dt;
      if (!inStop && stopRun >= MIN_STOP_MS) {
        inStop = true;
        stops++;
      }
    } else {
      movingTime += dt;
      movingDist += dd;
      stopRun = 0;
      inStop = false;
    }
  }

  const speeds = points.length ? filteredSpeeds(points) : [];
  let maxSpeed = 0;
  for (const s of speeds) if (s > maxSpeed) maxSpeed = s;

  return {
    movingTime,
    stoppedTime,
    stops,
    maxSpeed,
    avgSpeed: duration > 0 ? distance / (duration / 1000) : 0,
    movingAvgSpeed: movingTime > 0 ? movingDist / (movingTime / 1000) : 0,
    elevationGain: elevationGain(points),
  };
}

/** Elevation gain with smoothing and a 3 m hysteresis, or null if altitude is not available. */
export function elevationGain(points: TrackPoint[]): number | null {
  const alts = points.filter((p) => p.alt != null);
  if (alts.length < Math.max(10, points.length * 0.5)) return null;
  let smooth = alts[0].alt!;
  let ref = smooth;
  let gain = 0;
  for (const p of alts) {
    smooth = smooth * 0.8 + p.alt! * 0.2;
    if (smooth - ref > 3) {
      gain += smooth - ref;
      ref = smooth;
    } else if (ref - smooth > 3) {
      ref = smooth;
    }
  }
  return gain;
}

export interface LapStat extends Lap {
  duration: number;
  distance: number;
  avgSpeed: number;
  maxSpeed: number;
}

export function computeLapStats(laps: Lap[], points: TrackPoint[]): LapStat[] {
  const speeds = points.length ? filteredSpeeds(points) : [];
  let j = 0;
  return laps.map((lap) => {
    let max = 0;
    while (j < points.length && points[j].e < lap.start) j++;
    let k = j;
    while (k < points.length && points[k].e <= lap.end) {
      if (speeds[k] > max) max = speeds[k];
      k++;
    }
    const duration = lap.end - lap.start;
    const distance = lap.endDist - lap.startDist;
    return { ...lap, duration, distance, avgSpeed: duration > 0 ? distance / (duration / 1000) : 0, maxSpeed: max };
  });
}

export interface LapSummary {
  best: number | null;
  worst: number | null;
  mean: number | null;
}

export function summarizeLaps(laps: { duration: number }[]): LapSummary {
  if (laps.length < 2) return { best: null, worst: null, mean: null };
  let best = 0;
  let worst = 0;
  let sum = 0;
  laps.forEach((l, i) => {
    sum += l.duration;
    if (l.duration < laps[best].duration) best = i;
    if (l.duration > laps[worst].duration) worst = i;
  });
  return { best, worst, mean: sum / laps.length };
}

export interface SpeedSample {
  /** Distance along track, m. */
  d: number;
  /** Stopwatch time, ms. */
  e: number;
  /** Speed, m/s. */
  v: number;
}

/** Speed profile resampled into ~`buckets` equal-distance bins for charting. */
export function speedProfile(points: TrackPoint[], buckets = 240): SpeedSample[] {
  if (points.length < 2) return points.map((p) => ({ d: p.d, e: p.e, v: p.spd }));
  const total = points[points.length - 1].d - points[0].d;
  if (total <= 0) return [];
  const speeds = filteredSpeeds(points);
  const step = total / buckets;
  const out: SpeedSample[] = [];
  let i = 0;
  for (let b = 0; b < buckets; b++) {
    const lo = points[0].d + b * step;
    const hi = lo + step;
    let sum = 0;
    let cnt = 0;
    let e = 0;
    while (i < points.length && points[i].d < hi) {
      if (points[i].d >= lo) {
        sum += speeds[i];
        cnt++;
        e = points[i].e;
      }
      i++;
    }
    if (cnt) out.push({ d: (lo + hi) / 2 - points[0].d, e, v: sum / cnt });
    else if (out.length) out.push({ d: (lo + hi) / 2 - points[0].d, e: out[out.length - 1].e, v: out[out.length - 1].v });
  }
  return out;
}

export interface SpeedBand {
  /** Lower bound in display units. */
  from: number;
  to: number;
  /** Stopwatch time spent in this band, ms. */
  time: number;
}

/** Time spent in each speed band. `toDisplay` converts m/s into the band unit. */
export function speedHistogram(points: TrackPoint[], bandWidth: number, toDisplay: (mps: number) => number): SpeedBand[] {
  const bands: SpeedBand[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.s !== b.s) continue;
    const dt = b.e - a.e;
    if (dt <= 0) continue;
    const v = toDisplay((a.spd + b.spd) / 2);
    const idx = Math.max(0, Math.floor(v / bandWidth));
    while (bands.length <= idx) bands.push({ from: bands.length * bandWidth, to: (bands.length + 1) * bandWidth, time: 0 });
    bands[idx].time += dt;
  }
  return bands;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Least-squares slope of y over x. */
export function slope(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den > 0 ? num / den : null;
}
