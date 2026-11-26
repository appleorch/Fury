import type { Map as MLMap, Marker } from 'maplibre-gl';
import { headingDiff } from '../lib/geo';

export interface FixPose {
  lat: number;
  lon: number;
  /** Heading in degrees, or null when unknown / stationary. */
  hdg: number | null;
  speed: number;
}

export interface CameraGoal {
  follow: boolean;
  headingUp: boolean;
  zoom: number;
  pitch: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => (a + headingDiff(a, b) * t + 360) % 360;
/** Frame-rate independent exponential smoothing factor for time constant `tau` ms. */
const ease = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);

/**
 * Moves the location puck and the follow camera smoothly between GPS fixes.
 *
 * GPS arrives in discrete steps (1 Hz on iPhone, several per second in Simulation) and not always on
 * time. Chasing the newest fix makes the puck pulse: it races, arrives, waits, races again. Instead the
 * puck is drawn a little in the past, about one fix interval behind, and interpolated between the two
 * fixes that bracket that moment using the fixes' own timestamps. The motion is then continuous,
 * like interpolation in a multiplayer game, at the cost of about a second of display lag. Timing,
 * laps and statistics always use the real fixes, so the lag never affects your times.
 */
export class FollowAnimator {
  private buf: (FixPose & { t: number })[] = [];
  private shown: { lat: number; lon: number; hdg: number } | null = null;
  private raf = 0;
  private lastFrame = 0;
  private camBearing: number | null = null;
  private goal: CameraGoal = { follow: true, headingUp: true, zoom: 16, pitch: 0 };
  private snapNext = true;
  private ownMove = false;
  /** Typical spacing of fix timestamps, ms (fix time, not wall time). */
  private gap = 1000;
  active = true;

  constructor(
    private readonly map: MLMap,
    private readonly puck: Marker,
    /** Clock that fix timestamps are on (the app clock, which runs fast in Simulation). */
    private readonly now: () => number,
    private readonly onFrame?: (pos: { lat: number; lon: number }) => void,
  ) {
    this.raf = requestAnimationFrame(this.frame);
  }

  push(fix: FixPose & { t: number }): void {
    const last = this.buf[this.buf.length - 1];
    if (last && fix.t <= last.t) {
      if (fix.t === last.t) return;
      this.buf = []; // clock went backwards (simulation reset): start over
    }
    if (last && fix.t > last.t) this.gap = this.gap * 0.8 + Math.min(5000, fix.t - last.t) * 0.2;
    // Teleport (>1 km) or first fix: jump straight there.
    if (!last || Math.abs(last.lat - fix.lat) + Math.abs(last.lon - fix.lon) > 0.01) {
      this.buf = [];
      this.snapNext = true;
    }
    this.buf.push({ ...fix });
    if (this.buf.length > 12) this.buf.shift();
  }

  setGoal(goal: CameraGoal): void {
    this.goal = goal;
  }

  /** Jump the camera to the puck on the next frame (first fix, recenter). */
  snap(): void {
    this.snapNext = true;
  }

  private sample(): { lat: number; lon: number; hdg: number; moving: boolean } | null {
    const b = this.buf;
    if (!b.length) return null;
    const T = this.now() - (this.gap * 1.15 + 120);
    const prevHdg = this.shown?.hdg ?? b[b.length - 1].hdg ?? 0;
    if (b.length === 1 || T <= b[0].t) {
      const f = b[0];
      return { lat: f.lat, lon: f.lon, hdg: f.hdg ?? prevHdg, moving: false };
    }
    for (let i = 1; i < b.length; i++) {
      if (T <= b[i].t) {
        const a = b[i - 1];
        const c = b[i];
        const k = (T - a.t) / (c.t - a.t);
        const moving = c.speed > 1.5 && c.hdg != null;
        const ha = a.hdg ?? c.hdg ?? prevHdg;
        const hc = c.hdg ?? ha;
        return { lat: lerp(a.lat, c.lat, k), lon: lerp(a.lon, c.lon, k), hdg: moving ? lerpAngle(ha, hc, k) : prevHdg, moving };
      }
    }
    // Fixes are late: keep gliding along the last direction for a moment, then hold.
    const a = b[b.length - 2];
    const c = b[b.length - 1];
    const over = Math.min(T - c.t, this.gap) / (c.t - a.t);
    const moving = c.speed > 1.5 && c.hdg != null;
    return { lat: c.lat + (c.lat - a.lat) * over, lon: c.lon + (c.lon - a.lon) * over, hdg: moving ? c.hdg! : prevHdg, moving };
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.lastFrame ? Math.min(100, now - this.lastFrame) : 16;
    this.lastFrame = now;
    const p = this.sample();
    if (!p) return;
    const { lat, lon, hdg, moving } = p;
    this.shown = { lat, lon, hdg };

    this.puck.setLngLat([lon, lat]);
    this.puck.setRotation(hdg);
    this.puck.getElement().classList.toggle('has-heading', moving);
    this.onFrame?.({ lat, lon });

    if (!this.active || !this.goal.follow || (this.map.isMoving() && !this.ownMove)) return;
    const g = this.goal;
    const targetBearing = g.headingUp ? (moving ? hdg : (this.camBearing ?? this.map.getBearing())) : 0;
    this.ownMove = true;
    if (this.snapNext || this.camBearing == null) {
      this.camBearing = targetBearing;
      this.map.jumpTo({ center: [lon, lat], bearing: targetBearing, zoom: g.zoom, pitch: g.pitch });
      this.snapNext = false;
    } else {
      this.camBearing = lerpAngle(this.camBearing, targetBearing, ease(dt, 350));
      const zoom = lerp(this.map.getZoom(), g.zoom, ease(dt, 1800));
      const pitch = lerp(this.map.getPitch(), g.pitch, ease(dt, 900));
      this.map.jumpTo({ center: [lon, lat], bearing: this.camBearing, zoom, pitch });
    }
    this.ownMove = false;
  };

  /** Position currently drawn. */
  get position(): { lat: number; lon: number } | null {
    return this.shown;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }
}
