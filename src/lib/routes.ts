import { haversine, lerp, projectOnSegment } from './geo';
import { mean, median, slope, stdev } from './stats';
import type { Checkpoint, LatLon, Route, TrackPoint, Trip } from './types';

export const DEFAULT_ROUTE_RADIUS = 250;
/** How close the track has to pass a checkpoint for it to count, metres. */
export const CHECKPOINT_RADIUS = 45;

export interface RouteMatch {
  route: Route;
  startDist: number;
  endDist: number;
}

/** Routes whose start and finish both lie within their radius of the given endpoints, best first. */
export function matchRoutes(start: LatLon | null, end: LatLon | null, routes: Route[]): RouteMatch[] {
  if (!start || !end) return [];
  return routes
    .map((route) => ({ route, startDist: haversine(start, route.start), endDist: haversine(end, route.end) }))
    .filter((m) => m.startDist <= m.route.radius && m.endDist <= m.route.radius)
    .sort((a, b) => a.startDist + a.endDist - (b.startDist + b.endDist));
}

/**
 * Whether a drive belongs to a route: it must start and finish within the route's radius, and (once the
 * route has history) be a plausible length, so a loop route isn't matched by a quick trip around the block.
 */
export function acceptsDrive(route: Route, start: LatLon | null, end: LatLon | null, distance: number, trips: Trip[]): boolean {
  if (!matchRoutes(start, end, [route]).length) return false;
  const ds = trips.filter((t) => t.routeId === route.id).map((t) => t.distance);
  if (!ds.length) return true;
  const m = median(ds);
  return distance >= m * 0.6 && distance <= m * 1.8;
}

/** The best saved route for a finished drive, if any. */
export function routeForDrive(start: LatLon | null, end: LatLon | null, distance: number, routes: Route[], trips: Trip[]): Route | null {
  return matchRoutes(start, end, routes).find((m) => acceptsDrive(m.route, start, end, distance, trips))?.route ?? null;
}

/** Routes sorted by how close their start is to `pos` (for the picker). */
export function routesNear(pos: LatLon | null, routes: Route[]): { route: Route; dist: number | null }[] {
  return routes
    .map((route) => ({ route, dist: pos ? haversine(pos, route.start) : null }))
    .sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity) || a.route.name.localeCompare(b.route.name));
}

/** Trips without a route that share this trip's start and finish (candidates for a new route). */
export function similarUnassigned(trip: Trip, trips: Trip[], radius = DEFAULT_ROUTE_RADIUS): Trip[] {
  if (!trip.start || !trip.end) return [];
  return trips.filter(
    (t) =>
      t.id !== trip.id &&
      !t.routeId &&
      t.start &&
      t.end &&
      haversine(t.start, trip.start!) <= radius &&
      haversine(t.end, trip.end!) <= radius,
  );
}

export function isLoop(trip: Trip, radius = DEFAULT_ROUTE_RADIUS): boolean {
  return !!trip.start && !!trip.end && trip.distance > radius * 4 && haversine(trip.start, trip.end) <= radius;
}

export function checkpointsKey(cps: Checkpoint[]): string {
  return cps.map((c) => `${c.lat.toFixed(5)},${c.lon.toFixed(5)}`).join('|');
}

export interface Crossing {
  /** Index of the segment start point. */
  idx: number;
  /** Interpolated stopwatch time at the closest approach. */
  e: number;
  /** Interpolated distance along the track. */
  d: number;
  /** Closest approach, metres. */
  dist: number;
}

/**
 * Find where the track passes `cp`, scanning forward from `fromIdx`. Uses the closest approach of the
 * first pass inside `radius`, interpolated within the GPS segment, so it works at highway speed with 1 Hz fixes.
 */
export function findCrossing(points: TrackPoint[], cp: LatLon, fromIdx = 0, radius = CHECKPOINT_RADIUS): Crossing | null {
  let best: Crossing | null = null;
  for (let i = Math.max(0, fromIdx); i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a.s !== b.s) continue;
    const pr = projectOnSegment(cp, a, b);
    if (pr.dist <= radius) {
      if (!best || pr.dist < best.dist) best = { idx: i, e: lerp(a.e, b.e, pr.t), d: lerp(a.d, b.d, pr.t), dist: pr.dist };
    } else if (best) {
      break;
    }
  }
  return best;
}

/** Stopwatch times at which each checkpoint was passed (null when missed). */
export function checkpointCrossings(points: TrackPoint[], cps: LatLon[]): (number | null)[] {
  const out: (number | null)[] = [];
  let from = 0;
  for (const cp of cps) {
    const c = findCrossing(points, cp, from);
    if (c) {
      out.push(c.e);
      from = c.idx;
    } else out.push(null);
  }
  return out;
}

/** Sector durations (checkpoints + 1 sectors) from crossings; null where a boundary was missed. */
export function sectorDurations(crossings: (number | null)[], duration: number): (number | null)[] {
  const bounds = [0, ...crossings, duration];
  const out: (number | null)[] = [];
  for (let i = 1; i < bounds.length; i++) {
    const a = bounds[i - 1];
    const b = bounds[i];
    out.push(a == null || b == null || b < a ? null : b - a);
  }
  return out;
}

export interface SectorStat {
  index: number;
  best: number | null;
  mean: number | null;
  count: number;
}

export interface DepartureBucket {
  /** Minutes after midnight for the bucket start. */
  from: number;
  to: number;
  mean: number;
  count: number;
}

export interface RouteStats {
  count: number;
  /** Chronological, oldest first. */
  runs: Trip[];
  /** Fastest first. */
  ranked: Trip[];
  best: Trip | null;
  worst: Trip | null;
  last: Trip | null;
  mean: number;
  median: number;
  stdev: number;
  meanDistance: number;
  /** Change in duration per week (ms), negative means getting faster. */
  trendPerWeek: number | null;
  weekday: { day: number; mean: number; count: number }[];
  departures: DepartureBucket[];
  sectors: SectorStat[];
  theoreticalBest: number | null;
}

export function routeTrips(routeId: string, trips: Trip[]): Trip[] {
  return trips.filter((t) => t.routeId === routeId);
}

export function minutesOfDay(epoch: number): number {
  const d = new Date(epoch);
  return d.getHours() * 60 + d.getMinutes();
}

export function computeRouteStats(route: Route, trips: Trip[], bucketMinutes = 15): RouteStats {
  const runs = routeTrips(route.id, trips).sort((a, b) => a.startedAt - b.startedAt);
  const ranked = [...runs].sort((a, b) => a.duration - b.duration);
  const durations = runs.map((r) => r.duration);

  const weekday = Array.from({ length: 7 }, (_, day) => {
    const ds = runs.filter((r) => new Date(r.startedAt).getDay() === day).map((r) => r.duration);
    return { day, mean: ds.length ? mean(ds) : NaN, count: ds.length };
  });

  const bucketMap = new Map<number, number[]>();
  for (const r of runs) {
    const b = Math.floor(minutesOfDay(r.startedAt) / bucketMinutes) * bucketMinutes;
    if (!bucketMap.has(b)) bucketMap.set(b, []);
    bucketMap.get(b)!.push(r.duration);
  }
  const departures = [...bucketMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([from, ds]) => ({ from, to: from + bucketMinutes, mean: mean(ds), count: ds.length }));

  const key = checkpointsKey(route.checkpoints);
  const nSectors = route.checkpoints.length ? route.checkpoints.length + 1 : 0;
  const sectors: SectorStat[] = [];
  for (let i = 0; i < nSectors; i++) {
    const vals: number[] = [];
    for (const r of runs) {
      if (r.sectors?.key !== key) continue;
      const v = sectorDurations(r.sectors.times, r.duration)[i];
      if (v != null) vals.push(v);
    }
    sectors.push({ index: i, best: vals.length ? Math.min(...vals) : null, mean: vals.length ? mean(vals) : null, count: vals.length });
  }
  const theoreticalBest =
    sectors.length && sectors.every((s) => s.best != null) ? sectors.reduce((a, s) => a + (s.best as number), 0) : null;

  const weeks = runs.map((r) => r.startedAt / (7 * 86400000));

  return {
    count: runs.length,
    runs,
    ranked,
    best: ranked[0] ?? null,
    worst: ranked[ranked.length - 1] ?? null,
    last: runs[runs.length - 1] ?? null,
    mean: mean(durations),
    median: median(durations),
    stdev: stdev(durations),
    meanDistance: mean(runs.map((r) => r.distance)),
    trendPerWeek: runs.length >= 5 ? slope(weeks, durations) : null,
    weekday,
    departures,
    sectors,
    theoreticalBest,
  };
}

/** 1-based rank of a trip among its route's runs (1 = fastest). */
export function rankOf(trip: Trip, stats: RouteStats): number {
  return stats.ranked.findIndex((t) => t.id === trip.id) + 1;
}

/** The run to race against live, per the user's comparison preference. */
export function referenceRun(stats: RouteStats, mode: 'best' | 'median' | 'last', excludeId?: string): Trip | null {
  const pool = stats.ranked.filter((t) => t.id !== excludeId);
  if (!pool.length) return null;
  if (mode === 'best') return pool[0];
  if (mode === 'median') return pool[Math.floor((pool.length - 1) / 2)];
  return [...pool].sort((a, b) => b.startedAt - a.startedAt)[0];
}

export function formatMinuteOfDay(m: number): string {
  const d = new Date();
  d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Plain-language observation about departure times, when the data supports one. */
export function departureInsight(stats: RouteStats): { fast: DepartureBucket; slow: DepartureBucket; diff: number } | null {
  const eligible = stats.departures.filter((b) => b.count >= 2);
  if (eligible.length < 2) return null;
  const fast = eligible.reduce((a, b) => (b.mean < a.mean ? b : a));
  const slow = eligible.reduce((a, b) => (b.mean > a.mean ? b : a));
  const diff = slow.mean - fast.mean;
  if (diff < 45000) return null;
  return { fast, slow, diff };
}
