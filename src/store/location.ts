import { clock } from '../lib/clock';
import { driveToFixes, mulberry32, simulateDrive } from '../lib/sample';
import type { RawFix } from '../lib/track';

export type LocationError = 'denied' | 'unavailable' | 'timeout';

export interface LocationSource {
  readonly simulated: boolean;
  start(onFix: (f: RawFix) => void, onError: (e: LocationError) => void): void;
  stop(): void;
}

export class GeolocationSource implements LocationSource {
  readonly simulated = false;
  private watchId: number | null = null;

  start(onFix: (f: RawFix) => void, onError: (e: LocationError) => void): void {
    if (!('geolocation' in navigator)) {
      onError('unavailable');
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        onFix({
          t: pos.timestamp || Date.now(),
          lat: c.latitude,
          lon: c.longitude,
          acc: c.accuracy ?? 999,
          spd: c.speed != null && Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null,
          hdg: c.heading != null && Number.isFinite(c.heading) && c.heading >= 0 ? c.heading : null,
          alt: c.altitude != null && Number.isFinite(c.altitude) ? c.altitude : null,
        });
      },
      (err) => onError(err.code === 1 ? 'denied' : err.code === 2 ? 'unavailable' : 'timeout'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
  }

  stop(): void {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }
}

/**
 * Simulation mode: a demo commute driven by a little physics model, replayed as GPS fixes. The car
 * waits at the start until `depart()` and then drives while the app clock runs as a time-lapse.
 */
export class SimulatedSource implements LocationSource {
  readonly simulated = true;
  private timer: ReturnType<typeof setInterval> | null = null;
  private fixes: RawFix[] = [];
  private departAt: number | null = null;
  private idx = 0;
  private lastEmit = 0;

  constructor(private readonly rate: number) {
    this.prepare();
  }

  private prepare() {
    const seed = Math.floor(Math.random() * 1e9);
    const r = mulberry32(seed);
    const freeway = 0.65 + r() * 0.4;
    const drive = simulateDrive({ freeway, surface: 0.85 + r() * 0.12, redChance: 0.45, seed });
    this.fixes = driveToFixes(drive, 0, seed);
    this.idx = 0;
  }

  depart(): void {
    if (this.departAt != null) return;
    clock.setRate(this.rate);
    this.departAt = clock.now();
  }

  /** Park back at the start with a freshly randomised drive. */
  reset(): void {
    this.departAt = null;
    this.prepare();
  }

  get driving(): boolean {
    return this.departAt != null && this.idx < this.fixes.length;
  }

  start(onFix: (f: RawFix) => void): void {
    this.stop();
    this.timer = setInterval(() => {
      const now = clock.now();
      if (this.departAt == null || this.idx >= this.fixes.length) {
        // Parked: one fix per second at the start (or the finish).
        if (Math.abs(now - this.lastEmit) >= 1000) {
          const f = this.fixes[Math.min(this.idx, this.fixes.length - 1)];
          this.lastEmit = now;
          onFix({ ...f, t: now, spd: 0, hdg: null });
        }
        return;
      }
      const simT = now - this.departAt;
      while (this.idx < this.fixes.length && this.fixes[this.idx].t <= simT) {
        const f = this.fixes[this.idx++];
        this.lastEmit = now;
        onFix({ ...f, t: this.departAt + f.t });
      }
    }, 100);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
