import { haversine } from './geo';
import type { TrackPoint } from './types';

export interface RawFix {
  t: number;
  lat: number;
  lon: number;
  acc: number;
  /** Device speed, m/s; null or negative when unknown. */
  spd: number | null;
  hdg: number | null;
  alt: number | null;
}

/** Fixes worse than this are shown on the map but not recorded, metres. */
export const MAX_ACCURACY = 65;
/** Faster than this between two fixes is treated as a GPS jump, m/s (≈ 320 km/h). */
const MAX_JUMP_SPEED = 90;

/**
 * Turns raw GPS fixes into a clean track: drops inaccurate fixes and jumps, and pins the position while
 * the car is stationary so that GPS drift at traffic lights does not add phantom distance.
 */
export class TrackBuilder {
  points: TrackPoint[];
  distance: number;
  segment: number;

  constructor(points: TrackPoint[] = [], segment = 0) {
    this.points = points;
    this.distance = points.length ? points[points.length - 1].d : 0;
    this.segment = segment;
  }

  /** Start a new line segment (after a pause) so the map does not connect across the gap. */
  newSegment(): void {
    this.segment++;
  }

  get last(): TrackPoint | undefined {
    return this.points[this.points.length - 1];
  }

  add(fix: RawFix, elapsed: number): TrackPoint | null {
    if (!(fix.acc <= MAX_ACCURACY)) return null;
    const last = this.last;
    if (last && fix.t <= last.t) return null;
    const devSpd = fix.spd != null && fix.spd >= 0 ? fix.spd : null;
    let lat = fix.lat;
    let lon = fix.lon;
    let spd = devSpd ?? 0;

    if (last && last.s === this.segment) {
      const dist = haversine(last, fix);
      const dt = (fix.t - last.t) / 1000;
      const implied = dist / dt;
      if (implied > MAX_JUMP_SPEED && dist > fix.acc + last.acc) return null;
      if (devSpd == null) spd = implied;
      const slow = (devSpd ?? implied) < 0.7;
      if (slow && dist < Math.max(8, Math.min(fix.acc, 25))) {
        lat = last.lat;
        lon = last.lon;
        spd = 0;
      } else {
        this.distance += dist;
      }
    }

    const p: TrackPoint = {
      t: fix.t,
      e: elapsed,
      lat,
      lon,
      spd,
      acc: Math.round(fix.acc * 10) / 10,
      alt: fix.alt,
      hdg: fix.hdg,
      d: this.distance,
      s: this.segment,
    };
    this.points.push(p);
    return p;
  }
}
