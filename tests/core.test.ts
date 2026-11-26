import { describe, expect, it } from 'vitest';
import { formatDelta, formatDuration, formatDistance, splitDuration } from '../src/lib/format';
import { decodePolyline, haversine, offset, projectOnSegment, simplifyTo } from '../src/lib/geo';
import { Ghost } from '../src/lib/ghost';
import {
  acceptsDrive,
  checkpointCrossings,
  computeRouteStats,
  matchRoutes,
  rankOf,
  referenceRun,
  sectorDurations,
} from '../src/lib/routes';
import { buildTripFromPoints, generateSampleHistory, sampleCheckpoints, samplePath, simulateDrive } from '../src/lib/sample';
import { computeLapStats, computeSummary, summarizeLaps } from '../src/lib/stats';
import { TrackBuilder, type RawFix } from '../src/lib/track';
import type { Route, TrackPoint } from '../src/lib/types';

const origin = { lat: 37.33, lon: -122.0 };

/** Straight drive north at a constant speed, one fix per second. */
function straightTrack(seconds: number, speed: number, startT = 0): TrackPoint[] {
  const b = new TrackBuilder();
  for (let s = 0; s <= seconds; s++) {
    const p = offset(origin, s * speed, 0);
    b.add({ t: startT + s * 1000, lat: p.lat, lon: p.lon, acc: 5, spd: speed, hdg: 0, alt: null }, s * 1000);
  }
  return b.points;
}

describe('format', () => {
  it('formats stopwatch times', () => {
    expect(formatDuration(0)).toBe('0:00.00');
    expect(formatDuration(83456)).toBe('1:23.45');
    expect(formatDuration(83456, 1)).toBe('1:23.4');
    expect(formatDuration(3723450, 0)).toBe('1:02:03');
    expect(splitDuration(83456)).toEqual({ main: '1:23', frac: '.45' });
  });
  it('formats deltas with a true minus sign', () => {
    expect(formatDelta(-12345)).toBe('−12.3');
    expect(formatDelta(4200)).toBe('+4.2');
    expect(formatDelta(-75000)).toBe('−1:15.0');
  });
  it('formats distances by unit', () => {
    expect(formatDistance(850, 'metric')).toBe('850 m');
    expect(formatDistance(12400, 'metric')).toBe('12.4 km');
    expect(formatDistance(100, 'imperial')).toBe('328 ft');
    expect(formatDistance(1609.344 * 3.5, 'imperial')).toBe('3.50 mi');
  });
});

describe('geo', () => {
  it('haversine is accurate for 1 km', () => {
    const p = offset(origin, 1000, 45);
    expect(haversine(origin, p)).toBeCloseTo(1000, 0);
  });
  it('projects a point onto a segment', () => {
    const a = origin;
    const b = offset(origin, 100, 90);
    const p = offset(offset(origin, 40, 90), 10, 0);
    const pr = projectOnSegment(p, a, b);
    expect(pr.t).toBeCloseTo(0.4, 2);
    expect(pr.dist).toBeCloseTo(10, 0);
  });
  it('decodes polylines', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });
  it('simplifies to a target size', () => {
    const pts = straightTrack(500, 10);
    expect(simplifyTo(pts, 50).length).toBeLessThanOrEqual(50);
  });
});

describe('track builder', () => {
  it('pins position while stationary so drift adds no distance', () => {
    const b = new TrackBuilder();
    for (let s = 0; s < 60; s++) {
      const jitter = offset(origin, 3, (s * 77) % 360);
      b.add({ t: s * 1000, lat: jitter.lat, lon: jitter.lon, acc: 6, spd: 0, hdg: null, alt: null }, s * 1000);
    }
    expect(b.distance).toBeLessThan(5);
  });
  it('rejects inaccurate fixes and teleports', () => {
    const b = new TrackBuilder();
    const fix = (t: number, p: { lat: number; lon: number }, acc = 5): RawFix => ({ t, ...p, acc, spd: 10, hdg: 0, alt: null });
    expect(b.add(fix(0, origin), 0)).not.toBeNull();
    expect(b.add(fix(1000, offset(origin, 10, 0), 200), 1000)).toBeNull();
    expect(b.add(fix(2000, offset(origin, 5000, 0)), 2000)).toBeNull();
    expect(b.add(fix(3000, offset(origin, 30, 0)), 3000)).not.toBeNull();
  });
});

describe('stats', () => {
  it('computes moving time, stops and speeds', () => {
    const moving = straightTrack(60, 20);
    const b = new TrackBuilder(moving.slice());
    const last = moving[moving.length - 1];
    for (let s = 1; s <= 30; s++) b.add({ t: last.t + s * 1000, lat: last.lat, lon: last.lon, acc: 5, spd: 0, hdg: null, alt: null }, last.e + s * 1000);
    const pts = b.points;
    const sum = computeSummary(pts, pts[pts.length - 1].e, pts[pts.length - 1].d);
    expect(sum.stops).toBe(1);
    expect(Math.abs(sum.stoppedTime - 30000)).toBeLessThanOrEqual(1000);
    expect(Math.abs(sum.movingTime - 60000)).toBeLessThanOrEqual(1000);
    expect(sum.maxSpeed).toBeCloseTo(20, 1);
    expect(sum.movingAvgSpeed).toBeCloseTo(20, 0);
  });
  it('computes lap stats', () => {
    const pts = straightTrack(100, 10);
    const laps = computeLapStats(
      [
        { n: 1, start: 0, end: 40000, startDist: 0, endDist: 400, lat: null, lon: null, auto: false },
        { n: 2, start: 40000, end: 100000, startDist: 400, endDist: 1000, lat: null, lon: null, auto: false },
      ],
      pts,
    );
    expect(laps[0].avgSpeed).toBeCloseTo(10, 1);
    expect(summarizeLaps(laps)).toEqual({ best: 0, worst: 1, mean: 50000 });
  });
});

describe('routes', () => {
  const route: Route = {
    id: 'r',
    name: 'R',
    color: '#000',
    start: origin,
    end: offset(origin, 2000, 0),
    radius: 250,
    checkpoints: [],
    createdAt: 0,
  };
  it('matches trips by start and finish', () => {
    expect(matchRoutes(offset(origin, 100, 90), offset(origin, 2050, 0), [route])).toHaveLength(1);
    expect(matchRoutes(offset(origin, 400, 90), offset(origin, 2050, 0), [route])).toHaveLength(0);
  });
  it('rejects drives of implausible length once a route has history', () => {
    const base = buildTripFromPoints('h', straightTrack(200, 10), {});
    const history = [{ ...base, routeId: 'r', distance: 2000 }];
    expect(acceptsDrive(route, origin, offset(origin, 2000, 0), 2100, history)).toBe(true);
    expect(acceptsDrive(route, origin, offset(origin, 2000, 0), 600, history)).toBe(false);
    expect(acceptsDrive(route, origin, offset(origin, 900, 0), 2000, history)).toBe(false);
  });
  it('finds checkpoint crossings with interpolation', () => {
    const pts = straightTrack(100, 25); // 25 m/s, 1 Hz → fixes 25 m apart
    const cp = offset(origin, 1012.5, 0);
    const [e] = checkpointCrossings(pts, [cp]);
    expect(e).not.toBeNull();
    expect(e!).toBeCloseTo(40500, -2);
    expect(sectorDurations([e], 100000)).toEqual([e, 100000 - e!]);
  });
  it('ranks runs and picks references', () => {
    const trips = [300, 200, 250].map((d, i) => ({
      ...buildTripFromPoints(`t${i}`, straightTrack(d, 7, i * 86400000), {}),
      routeId: 'r',
    }));
    const stats = computeRouteStats(route, trips);
    expect(stats.best?.id).toBe('t1');
    expect(rankOf(trips[2], stats)).toBe(2);
    expect(referenceRun(stats, 'median')?.id).toBe('t2');
    expect(referenceRun(stats, 'last')?.id).toBe('t2');
    expect(referenceRun(stats, 'best', 't1')?.id).toBe('t2');
  });
});

describe('ghost', () => {
  it('reports how far ahead or behind the reference you are', () => {
    const ref = straightTrack(200, 10); // reference: 10 m/s
    const g = new Ghost(ref);
    // We are at 1000 m after 90 s; reference reached 1000 m at 100 s → 10 s ahead.
    const st = g.update(offset(origin, 1000, 0), 90000);
    expect(st.offRoute).toBe(false);
    expect(st.delta!).toBeCloseTo(-10000, -2);
    expect(st.predicted!).toBeCloseTo(190000, -2);
    // Far away → off route
    expect(g.update(offset(origin, 1000, 90), 91000).offRoute).toBe(true);
  });
});

describe('sample data', () => {
  it('simulates a plausible commute', () => {
    const path = samplePath();
    expect(path[path.length - 1].s).toBeGreaterThan(12000);
    const drive = simulateDrive({ freeway: 1, surface: 1, redChance: 0.5, seed: 7 });
    const minutes = drive.length / 60;
    expect(minutes).toBeGreaterThan(10);
    expect(minutes).toBeLessThan(30);
    const top = Math.max(...drive.map((d) => d.v));
    expect(top).toBeGreaterThan(25);
    expect(top).toBeLessThan(40);
  });
  it('generates history where every run passes both checkpoints', () => {
    const { route, trips } = generateSampleHistory(Date.UTC(2026, 10, 26, 12));
    expect(trips.length).toBeGreaterThan(15);
    for (const { trip } of trips) {
      expect(trip.sectors!.times.every((t) => t != null)).toBe(true);
      expect(trip.laps).toHaveLength(sampleCheckpoints().length + 1);
      expect(trip.distance).toBeGreaterThan(12500);
    }
    const stats = computeRouteStats(route, trips.map((t) => t.trip));
    expect(stats.theoreticalBest!).toBeLessThanOrEqual(stats.best!.duration + 1);
    expect(stats.best!.duration).toBeLessThan(stats.worst!.duration);
  });
});
