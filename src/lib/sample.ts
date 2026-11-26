import { bearing, decodePolyline, haversine, headingDiff, lerp, offset, simplifyTo } from './geo';
import { checkpointCrossings, checkpointsKey } from './routes';
import { computeSummary } from './stats';
import { TrackBuilder, type RawFix } from './track';
import { SAMPLE_POLYLINE, SAMPLE_SPEEDS, SAMPLE_STOPS } from './sampleRouteData';
import type { Checkpoint, Lap, LatLon, Route, TrackPoint, Trip } from './types';

/** Deterministic PRNG so sample data is stable between loads. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand: () => number): number {
  const u = Math.max(1e-9, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

interface PathSample extends LatLon {
  s: number; // distance along path
  limit: number; // speed limit m/s
}

let cachedPath: PathSample[] | null = null;

/** Sample route resampled every 5 m, carrying a speed limit that includes curvature. */
export function samplePath(): PathSample[] {
  if (cachedPath) return cachedPath;
  const coords = decodePolyline(SAMPLE_POLYLINE).map(([lat, lon]) => ({ lat, lon }));
  const step = 5;
  // OSRM free-flow speeds are conservative on the freeway; real drivers run a bit quicker there.
  const limitOf = (i: number) => {
    const v = SAMPLE_SPEEDS[Math.min(i, SAMPLE_SPEEDS.length - 1)] ?? 10;
    return v > 20 ? v * 1.12 : v * 1.05;
  };
  const out: PathSample[] = [{ ...coords[0], s: 0, limit: limitOf(0) }];
  let cum = 0;
  let nextS = step;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const len = haversine(a, b);
    while (len > 0 && nextS <= cum + len) {
      const t = (nextS - cum) / len;
      out.push({ lat: lerp(a.lat, b.lat, t), lon: lerp(a.lon, b.lon, t), s: nextS, limit: limitOf(i) });
      nextS += step;
    }
    cum += len;
  }
  const last = coords[coords.length - 1];
  if (cum > out[out.length - 1].s) out.push({ ...last, s: cum, limit: 5 });

  // Curvature limit: v = sqrt(a_lat * radius), from the heading change over ±25 m.
  const k = 5;
  const curved = out.map((p, i) => {
    const a = out[Math.max(0, i - k)];
    const b = out[Math.min(out.length - 1, i + k)];
    if (a === p || b === p) return p.limit;
    const turn = Math.abs(headingDiff(bearing(a, p), bearing(p, b))) * (Math.PI / 180);
    if (turn < 0.02) return p.limit;
    const radius = (b.s - a.s) / turn;
    return Math.min(p.limit, Math.sqrt(2.6 * radius));
  });
  out.forEach((p, i) => (p.limit = Math.max(3, curved[i])));
  cachedPath = out;
  return out;
}

export interface DriveProfile {
  /** Multiplier on freeway speed (traffic). */
  freeway: number;
  /** Multiplier on surface street speed. */
  surface: number;
  /** Probability that each light is red. */
  redChance: number;
  seed: number;
}

interface TimedSample extends LatLon {
  t: number; // seconds from start
  v: number;
  hdg: number;
}

/** Physics-ish speed profile along the sample path, then sampled once per second. */
export function simulateDrive(profile: DriveProfile): TimedSample[] {
  const rand = mulberry32(profile.seed);
  const path = samplePath();
  const n = path.length;
  const vmax = path.map((p) => p.limit * (p.limit > 20 ? profile.freeway : profile.surface) * (0.96 + rand() * 0.08));
  vmax[0] = 0;
  vmax[n - 1] = 0;

  // Red lights: forced stops with a dwell time.
  const dwell = new Map<number, number>();
  for (const [lat, lon] of SAMPLE_STOPS.slice(0, -1)) {
    if (rand() > profile.redChance) {
      // green: still slow for the turn
      continue;
    }
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = haversine(path[i], { lat, lon });
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const idx = Math.max(1, best - 3);
    vmax[idx] = 0;
    dwell.set(idx, 8 + rand() * 40);
  }

  const v = vmax.slice();
  const accel = 2.0;
  const decel = 2.6;
  for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * accel * (path[i].s - path[i - 1].s)));
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * decel * (path[i + 1].s - path[i].s)));

  // Time at each path sample.
  const times = new Array<number>(n);
  times[0] = 0;
  for (let i = 1; i < n; i++) {
    const avg = Math.max(0.4, (v[i - 1] + v[i]) / 2);
    times[i] = times[i - 1] + (path[i].s - path[i - 1].s) / avg + (dwell.get(i - 1) ?? 0);
  }

  // Sample once per second.
  const out: TimedSample[] = [];
  let j = 0;
  const end = times[n - 1];
  for (let t = 0; t <= end; t += 1) {
    while (j < n - 2 && times[j + 1] < t) j++;
    const dwellHere = dwell.get(j) ?? 0;
    const moveStart = times[j] + dwellHere;
    const a = path[j];
    const b = path[j + 1];
    let f = 0;
    let speed = 0;
    if (t > moveStart) {
      f = Math.min(1, (t - moveStart) / Math.max(0.01, times[j + 1] - moveStart));
      speed = lerp(v[j], v[j + 1], f);
    }
    out.push({ lat: lerp(a.lat, b.lat, f), lon: lerp(a.lon, b.lon, f), t, v: speed, hdg: bearing(a, b) });
  }
  return out;
}

/** Turn a simulated drive into raw GPS fixes with realistic noise. */
export function driveToFixes(drive: TimedSample[], startEpoch: number, seed: number): RawFix[] {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  let nx = 0;
  let ny = 0;
  return drive.map((s) => {
    nx = nx * 0.8 + gauss(rand) * 0.9;
    ny = ny * 0.8 + gauss(rand) * 0.9;
    const moved = offset(offset(s, nx, 90), ny, 0);
    return {
      t: startEpoch + s.t * 1000,
      lat: moved.lat,
      lon: moved.lon,
      acc: 4 + Math.abs(gauss(rand)) * 2,
      spd: Math.max(0, s.v + (s.v > 0.5 ? gauss(rand) * 0.25 : 0)),
      hdg: s.v > 0.5 ? s.hdg : null,
      alt: 40 + Math.sin(s.t / 120) * 15,
    };
  });
}

export function sampleCheckpoints(): Checkpoint[] {
  return [
    { id: 'cp-freeway', name: 'I-280 on-ramp', lat: 37.315729, lon: -121.914719 },
    { id: 'cp-exit', name: 'Lawrence exit', lat: 37.319343, lon: -121.992438 },
  ];
}

export function sampleEndpoints(): { start: LatLon; end: LatLon } {
  const path = samplePath();
  return { start: path[0], end: path[path.length - 1] };
}

export function buildTripFromPoints(
  id: string,
  points: TrackPoint[],
  extra: Partial<Trip> & { laps?: Lap[] },
): Trip {
  const duration = extra.duration ?? (points.length ? points[points.length - 1].e : 0);
  const distance = extra.distance ?? (points.length ? points[points.length - 1].d : 0);
  return {
    id,
    startedAt: points[0]?.t ?? Date.now(),
    endedAt: points[points.length - 1]?.t ?? Date.now(),
    routeId: null,
    laps: [],
    pauses: [],
    duration,
    distance,
    start: points[0] ? { lat: points[0].lat, lon: points[0].lon } : null,
    end: points.length ? { lat: points[points.length - 1].lat, lon: points[points.length - 1].lon } : null,
    stats: computeSummary(points, duration, distance),
    preview: simplifyTo(points, 120).map((p) => [p.lat, p.lon] as [number, number]),
    ...extra,
  };
}

/** Laps cut at the given checkpoints (as auto-lap would have done live). */
export function lapsAtCheckpoints(points: TrackPoint[], cps: LatLon[]): Lap[] {
  const crossings = checkpointCrossings(points, cps);
  const laps: Lap[] = [];
  let start = 0;
  let startDist = 0;
  const duration = points[points.length - 1].e;
  const total = points[points.length - 1].d;
  const ends: { e: number; cp: LatLon | null }[] = [];
  crossings.forEach((e, i) => e != null && ends.push({ e, cp: cps[i] }));
  ends.push({ e: duration, cp: null });
  for (const end of ends) {
    const idx = points.findIndex((p) => p.e >= end.e);
    const endDist = end.cp ? points[Math.max(0, idx)].d : total;
    laps.push({
      n: laps.length + 1,
      start,
      end: end.e,
      startDist,
      endDist,
      lat: end.cp?.lat ?? null,
      lon: end.cp?.lon ?? null,
      auto: !!end.cp,
    });
    start = end.e;
    startDist = endDist;
  }
  return laps;
}

/** A sample commute route plus several weeks of history, for exploring the app before a real drive. */
export function generateSampleHistory(now = Date.now()): { route: Route; trips: { trip: Trip; points: TrackPoint[] }[] } {
  const { start, end } = sampleEndpoints();
  const checkpoints = sampleCheckpoints();
  const route: Route = {
    id: 'sample-route',
    name: 'Home → Work',
    color: '#0a84ff',
    start,
    end,
    radius: 250,
    checkpoints,
    createdAt: now - 45 * 86400000,
    sample: true,
  };
  const key = checkpointsKey(checkpoints);
  const rand = mulberry32(42);
  const trips: { trip: Trip; points: TrackPoint[] }[] = [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  for (let day = 36; day >= 1; day--) {
    const date = new Date(today.getTime() - day * 86400000);
    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue;
    if (rand() < 0.15) continue; // a day off
    const depart = 7 * 60 + 5 + Math.floor(rand() * 95); // 7:05–8:40
    date.setHours(Math.floor(depart / 60), depart % 60, Math.floor(rand() * 60), 0);
    // Traffic peaks around 8:15; Fridays are lighter; the driver gets a bit quicker over time.
    const peak = Math.exp(-(((depart - 495) / 28) ** 2));
    const learning = 1 + (36 - day) * 0.002;
    const freeway = (1.02 - peak * 0.42 - rand() * 0.08 + (dow === 5 ? 0.06 : 0)) * learning;
    const surface = (0.95 - peak * 0.12 - rand() * 0.06) * learning;
    const seed = 1000 + day;
    const drive = simulateDrive({ freeway, surface, redChance: 0.35 + peak * 0.35, seed });
    const fixes = driveToFixes(drive, date.getTime(), seed);
    const builder = new TrackBuilder();
    for (const f of fixes) builder.add(f, f.t - fixes[0].t);
    const points = builder.points;
    const id = `sample-${day}`;
    const trip = buildTripFromPoints(id, points, {
      routeId: route.id,
      sample: true,
      laps: lapsAtCheckpoints(points, checkpoints),
    });
    trip.sectors = { key, times: checkpointCrossings(points, checkpoints) };
    trips.push({ trip, points });
  }
  return { route, trips };
}
