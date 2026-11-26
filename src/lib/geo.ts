import type { LatLon } from './types';

const R = 6371008.8; // mean Earth radius, metres
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b, degrees 0..360. */
export function bearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest signed difference between two headings, degrees in [-180, 180). */
export function headingDiff(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

export interface Projection {
  /** Position along the segment, 0..1 (clamped). */
  t: number;
  /** Distance from the point to the segment, metres. */
  dist: number;
}

/**
 * Project p onto segment a→b using a local equirectangular approximation.
 * Accurate to well under a metre for segments shorter than a few km.
 */
export function projectOnSegment(p: LatLon, a: LatLon, b: LatLon): Projection {
  const kx = Math.cos(toRad((a.lat + b.lat) / 2)) * (Math.PI / 180) * R;
  const ky = (Math.PI / 180) * R;
  const ax = 0;
  const ay = 0;
  const bx = (b.lon - a.lon) * kx;
  const by = (b.lat - a.lat) * ky;
  const px = (p.lon - a.lon) * kx;
  const py = (p.lat - a.lat) * ky;
  const len2 = bx * bx + by * by;
  let t = len2 > 0 ? ((px - ax) * bx + (py - ay) * by) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * bx;
  const cy = ay + t * by;
  return { t, dist: Math.hypot(px - cx, py - cy) };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function centroid(points: LatLon[]): LatLon {
  let lat = 0;
  let lon = 0;
  for (const p of points) {
    lat += p.lat;
    lon += p.lon;
  }
  return { lat: lat / points.length, lon: lon / points.length };
}

export interface Bounds {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export function boundsOf(points: { lat: number; lon: number }[]): Bounds | null {
  if (!points.length) return null;
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return { minLat, minLon, maxLat, maxLon };
}

/** Douglas–Peucker simplification with a tolerance in metres. Returns indices kept. */
export function simplifyIndices(points: LatLon[], tolerance: number): number[] {
  const n = points.length;
  if (n <= 2) return points.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = projectOnSegment(points[i], points[s], points[e]).dist;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/** Simplify to roughly `target` points by growing the tolerance. */
export function simplifyTo<T extends LatLon>(points: T[], target: number): T[] {
  if (points.length <= target) return points.slice();
  let tol = 2;
  let idx = simplifyIndices(points, tol);
  while (idx.length > target && tol < 5000) {
    tol *= 1.6;
    idx = simplifyIndices(points, tol);
  }
  return idx.map((i) => points[i]);
}

/** Move `dist` metres from p along `brng` degrees. */
export function offset(p: LatLon, dist: number, brng: number): LatLon {
  const d = dist / R;
  const b = toRad(brng);
  const lat1 = toRad(p.lat);
  const lon1 = toRad(p.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lon: toDeg(lon2) };
}

/** Decode a Google encoded polyline (precision 5) to [lat, lon] pairs. */
export function decodePolyline(str: string, precision = 5): [number, number][] {
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lon += delta;
    }
    out.push([lat / factor, lon / factor]);
  }
  return out;
}
