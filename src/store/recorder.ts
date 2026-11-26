import { useSyncExternalStore } from 'react';
import { clock } from '../lib/clock';
import { haptic, setKeepAwake, speak, spokenDelta, spokenDuration } from '../lib/device';
import { formatDelta, formatDuration } from '../lib/format';
import { haversine, lerp, projectOnSegment } from '../lib/geo';
import { Ghost, type GhostState } from '../lib/ghost';
import { acceptsDrive, CHECKPOINT_RADIUS, checkpointsKey, computeRouteStats, referenceRun, sectorDurations } from '../lib/routes';
import { buildTripFromPoints } from '../lib/sample';
import { TrackBuilder, type RawFix } from '../lib/track';
import type { Lap, PauseSpan, Route, TrackPoint, Trip } from '../lib/types';
import { dataStore, newId } from './data';
import * as db from './db';
import { GeolocationSource, SimulatedSource, type LocationError, type LocationSource } from './location';
import { settingsStore } from './settings';

export type RecState = 'idle' | 'recording' | 'paused';
export type GpsStatus = 'off' | 'searching' | 'good' | 'fair' | 'poor' | 'denied' | 'unavailable';

export interface LiveFix extends RawFix {
  receivedAt: number;
}

export interface LapFlash {
  n: number;
  /** Banner title, e.g. "Lap 3" or a checkpoint name. */
  label: string;
  duration: number;
  delta: number | null;
  against: string | null;
  auto: boolean;
  at: number;
}

export interface GhostRef {
  tripId: string;
  duration: number;
  distance: number;
  label: string;
  /** Sector durations of the reference run, aligned with the route's checkpoints. */
  sectors: (number | null)[] | null;
}

export interface RecorderSnapshot {
  state: RecState;
  sessionId: string | null;
  startedAt: number | null;
  /** Clock time the current active span began (null while paused/idle). */
  activeSince: number | null;
  /** Active ms accumulated before `activeSince`. */
  accumulated: number;
  laps: Lap[];
  lapStart: number;
  lapStartDist: number;
  distance: number;
  /** Increments whenever the track changes (cheap change detection for the map). */
  trackVersion: number;
  routeId: string | null;
  /** Name for a new route that will be created from this drive when it finishes. */
  pendingRouteName: string | null;
  fix: LiveFix | null;
  speed: number;
  heading: number | null;
  gps: GpsStatus;
  ghost: GhostState | null;
  ghostRef: GhostRef | null;
  simulated: boolean;
  lapFlash: LapFlash | null;
  /** Set when the drive finished on its own (auto-finish) so the UI can show the summary. */
  autoFinished: { tripId: string; at: number } | null;
}

interface PersistedSession {
  key: 'session';
  id: string;
  state: 'recording' | 'paused';
  startedAt: number;
  activeSince: number | null;
  accumulated: number;
  pauses: PauseSpan[];
  points: TrackPoint[];
  laps: Lap[];
  lapStart: number;
  lapStartDist: number;
  segment: number;
  routeId: string | null;
  pendingRouteName?: string | null;
  nextCheckpoint: number;
  simulated: boolean;
}

interface Candidate {
  e: number;
  d: number;
  dist: number;
}

const initial: RecorderSnapshot = {
  state: 'idle',
  sessionId: null,
  startedAt: null,
  activeSince: null,
  accumulated: 0,
  laps: [],
  lapStart: 0,
  lapStartDist: 0,
  distance: 0,
  trackVersion: 0,
  routeId: null,
  pendingRouteName: null,
  fix: null,
  speed: 0,
  heading: null,
  gps: 'off',
  ghost: null,
  ghostRef: null,
  simulated: false,
  lapFlash: null,
  autoFinished: null,
};

class Recorder {
  private snap: RecorderSnapshot = initial;
  private listeners = new Set<() => void>();
  private builder = new TrackBuilder();
  private pauses: PauseSpan[] = [];
  private source: LocationSource | null = null;
  private watchers = 0;
  private ghost: Ghost | null = null;
  private nextCheckpoint = 0;
  private cpCandidate: Candidate | null = null;
  private finishCandidate: Candidate | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPersist = 0;
  private finishing = false;

  // ---- store plumbing -------------------------------------------------------
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.snap;
  private set(patch: Partial<RecorderSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** Track points recorded so far (do not mutate). */
  points(): TrackPoint[] {
    return this.builder.points;
  }

  elapsed(at = clock.now()): number {
    const s = this.snap;
    return s.accumulated + (s.activeSince != null ? Math.max(0, at - s.activeSince) : 0);
  }

  currentLapElapsed(at = clock.now()): number {
    return this.elapsed(at) - this.snap.lapStart;
  }

  get route(): Route | undefined {
    return dataStore.route(this.snap.routeId);
  }

  // ---- lifecycle -------------------------------------------------------------
  async init(): Promise<void> {
    const saved = await db.get<PersistedSession>('kv', 'session').catch(() => undefined);
    if (saved && !saved.simulated) {
      this.builder = new TrackBuilder(saved.points, saved.segment);
      this.pauses = saved.pauses;
      this.nextCheckpoint = saved.nextCheckpoint;
      this.set({
        state: saved.state,
        sessionId: saved.id,
        startedAt: saved.startedAt,
        activeSince: saved.activeSince,
        accumulated: saved.accumulated,
        laps: saved.laps,
        lapStart: saved.lapStart,
        lapStartDist: saved.lapStartDist,
        distance: this.builder.distance,
        trackVersion: this.snap.trackVersion + 1,
        routeId: saved.routeId,
        pendingRouteName: saved.pendingRouteName ?? null,
      });
      this.ensureSource();
      if (saved.state === 'recording') setKeepAwake(settingsStore.get().keepAwake);
      void this.loadGhost();
    } else if (saved) {
      await db.del('kv', 'session');
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.persist(true);
    });
    window.addEventListener('pagehide', () => void this.persist(true));
    settingsStore.subscribe(() => this.onSettingsChanged());
  }

  private lastCompareTo = settingsStore.get().compareTo;

  private onSettingsChanged() {
    const s = settingsStore.get();
    if (s.compareTo !== this.lastCompareTo) {
      this.lastCompareTo = s.compareTo;
      void this.loadGhost();
    }
    if (this.snap.state === 'idle' && this.source && this.source.simulated !== s.simulate) {
      this.restartSource();
    }
    if (this.snap.state === 'recording') setKeepAwake(s.keepAwake);
  }

  /** Start listening to location (ref-counted: the Drive screen and an active recording both hold one). */
  acquire(): () => void {
    this.watchers++;
    this.ensureSource();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.watchers--;
      this.maybeStopSource();
    };
  }

  private ensureSource() {
    if (this.source) return;
    const s = settingsStore.get();
    this.source = s.simulate ? new SimulatedSource(s.simulateRate) : new GeolocationSource();
    this.set({ gps: this.snap.fix ? this.snap.gps : 'searching', simulated: this.source.simulated });
    this.source.start(
      (f) => this.onFix(f),
      (e) => this.onError(e),
    );
  }

  private restartSource() {
    this.source?.stop();
    this.source = null;
    this.set({ fix: null, gps: 'off', speed: 0 });
    if (this.watchers > 0 || this.snap.state !== 'idle') this.ensureSource();
  }

  private maybeStopSource() {
    if (this.watchers <= 0 && this.snap.state === 'idle' && this.source) {
      this.source.stop();
      this.source = null;
      this.set({ gps: 'off' });
    }
  }

  private onError(e: LocationError) {
    if (e === 'denied') this.set({ gps: 'denied' });
    else if (e === 'unavailable') this.set({ gps: this.snap.fix ? 'poor' : 'unavailable' });
  }

  // ---- route & ghost -------------------------------------------------------
  async setRoute(routeId: string | null): Promise<void> {
    if (routeId === this.snap.routeId) return;
    this.nextCheckpoint = 0;
    this.cpCandidate = null;
    this.finishCandidate = null;
    this.set({ routeId, pendingRouteName: null, ghost: null, ghostRef: null });
    if (this.snap.state !== 'idle') this.schedulePersist();
    await this.loadGhost();
  }

  /** Name a new route; it is created from this drive's start and finish when the drive ends. */
  setPendingRoute(name: string | null): void {
    this.nextCheckpoint = 0;
    this.ghost = null;
    this.set({ routeId: null, pendingRouteName: name?.trim() || null, ghost: null, ghostRef: null });
    if (this.snap.state !== 'idle') this.schedulePersist();
  }

  private async loadGhost() {
    const route = this.route;
    this.ghost = null;
    if (!route) return;
    const stats = computeRouteStats(route, dataStore.get().trips);
    const mode = settingsStore.get().compareTo;
    const ref = referenceRun(stats, mode, this.snap.sessionId ?? undefined);
    if (!ref) {
      this.set({ ghostRef: null, ghost: null });
      return;
    }
    const points = await dataStore.getTrack(ref.id);
    if (this.snap.routeId !== route.id || points.length < 2) return;
    this.ghost = new Ghost(points);
    const key = checkpointsKey(route.checkpoints);
    const label = mode === 'best' ? 'best' : mode === 'median' ? 'typical' : 'last run';
    this.set({
      ghostRef: {
        tripId: ref.id,
        duration: ref.duration,
        distance: ref.distance,
        label,
        sectors: ref.sectors?.key === key ? sectorDurations(ref.sectors.times, ref.duration) : null,
      },
    });
    // Catch up if we are already moving.
    const last = this.builder.last;
    if (last && this.snap.state !== 'idle') this.set({ ghost: this.ghost.update(last, last.e) });
  }

  // ---- controls ------------------------------------------------------------
  start(): void {
    if (this.snap.state !== 'idle') return;
    this.ensureSource();
    const now = clock.now();
    this.builder = new TrackBuilder();
    this.pauses = [];
    this.nextCheckpoint = 0;
    this.cpCandidate = null;
    this.finishCandidate = null;
    this.ghost?.reset();
    this.set({
      state: 'recording',
      sessionId: newId(),
      startedAt: now,
      activeSince: now,
      accumulated: 0,
      laps: [],
      lapStart: 0,
      lapStartDist: 0,
      distance: 0,
      trackVersion: this.snap.trackVersion + 1,
      ghost: null,
      lapFlash: null,
      autoFinished: null,
    });
    if (this.source instanceof SimulatedSource) {
      this.source.depart();
      this.set({ startedAt: clock.now(), activeSince: clock.now() });
    }
    // Seed the track with the current position so the line starts where you are.
    const f = this.snap.fix;
    if (f && clock.now() - f.receivedAt < 5000) this.builder.add({ ...f, t: this.snap.startedAt! }, 0);
    setKeepAwake(settingsStore.get().keepAwake);
    this.feedback();
    // iOS only lets a page speak after a user gesture has spoken once; do it now so later
    // automatic split announcements work.
    if (settingsStore.get().voice) speak('Timer started');
    void this.persist(true);
  }

  pause(): void {
    if (this.snap.state !== 'recording') return;
    const now = clock.now();
    this.pauses.push({ start: now, end: now });
    this.set({ state: 'paused', accumulated: this.elapsed(now), activeSince: null });
    this.feedback();
    void this.persist(true);
  }

  resume(): void {
    if (this.snap.state !== 'paused') return;
    const now = clock.now();
    const p = this.pauses[this.pauses.length - 1];
    if (p) p.end = now;
    this.builder.newSegment();
    this.cpCandidate = null;
    this.set({ state: 'recording', activeSince: now });
    this.feedback();
    void this.persist(true);
  }

  lap(): void {
    if (this.snap.state !== 'recording') return;
    const e = this.elapsed();
    const last = this.builder.last;
    this.addLap(e, this.builder.distance, last?.lat ?? this.snap.fix?.lat ?? null, last?.lon ?? this.snap.fix?.lon ?? null, false);
  }

  private addLap(end: number, endDist: number, lat: number | null, lon: number | null, auto: boolean, label?: string) {
    const s = this.snap;
    if (end - s.lapStart < 1000) return; // debounce double taps
    const lap: Lap = { n: s.laps.length + 1, start: s.lapStart, end, startDist: s.lapStartDist, endDist, lat, lon, auto };
    let duration = end - s.lapStart;

    // Checkpoint splits compare the sector (previous checkpoint → this one) with the reference run's
    // same sector, so they stay meaningful even if you also tapped Lap in between.
    // Manual laps compare with this drive's best lap so far.
    let delta: number | null = null;
    let against: string | null = null;
    if (auto) {
      const prevCheckpoint = [...s.laps].reverse().find((l) => l.auto)?.end ?? 0;
      duration = end - prevCheckpoint;
      const refSector = s.ghostRef?.sectors?.[this.nextCheckpoint - 1];
      if (refSector != null) {
        delta = duration - refSector;
        against = s.ghostRef!.label;
      }
    } else if (s.laps.length) {
      const best = Math.min(...s.laps.map((l) => l.end - l.start));
      delta = duration - best;
      against = 'best lap';
    }
    this.set({
      laps: [...s.laps, lap],
      lapStart: end,
      lapStartDist: endDist,
      lapFlash: { n: lap.n, label: label ?? `Lap ${lap.n}`, duration, delta, against, auto, at: clock.now() },
    });
    this.feedback();
    if (settingsStore.get().voice) {
      speak(`${label ?? `Lap ${lap.n}`}. ${spokenDuration(duration)}.${delta != null && against ? ' ' + spokenDelta(delta, against) + '.' : ''}`);
    }
    this.schedulePersist();
  }

  async finish(): Promise<Trip | null> {
    if (this.snap.state === 'idle' || this.finishing) return null;
    this.finishing = true;
    try {
      const now = clock.now();
      let duration = this.elapsed(now);
      if (this.snap.state === 'paused') {
        const p = this.pauses[this.pauses.length - 1];
        if (p) p.end = now;
      }
      // Auto-finish trims the stopwatch to the exact moment you reached the finish.
      if (this.finishCandidate) {
        duration = Math.min(duration, this.finishCandidate.e);
        this.builder.points = this.builder.points.filter((p) => p.e <= duration);
      }
      const points = this.builder.points.slice();
      const distance = Math.min(this.builder.distance, this.finishCandidate?.d ?? Infinity);
      const s = this.snap;
      let laps = s.laps.filter((l) => l.end <= duration);
      const lastEnd = laps.length ? laps[laps.length - 1].end : 0;
      if (duration - lastEnd >= 1000 || !laps.length) {
        const lp = points[points.length - 1];
        laps = [
          ...laps,
          {
            n: laps.length + 1,
            start: lastEnd,
            end: duration,
            startDist: laps.length ? laps[laps.length - 1].endDist : 0,
            endDist: distance,
            lat: lp?.lat ?? null,
            lon: lp?.lon ?? null,
            auto: false,
          },
        ];
      } else if (laps.length) {
        laps[laps.length - 1] = { ...laps[laps.length - 1], end: duration, endDist: distance };
      }

      const id = s.sessionId ?? newId();
      let trip: Trip | null = null;
      if (points.length >= 2 && duration >= 3000) {
        // Only count the drive towards the selected route if it really started and finished there;
        // otherwise a drive you stopped halfway would show up as a record.
        const selected = dataStore.route(s.routeId);
        const first = points[0];
        const last = points[points.length - 1];
        const matches = !selected || acceptsDrive(selected, first, last, Math.min(this.builder.distance, this.finishCandidate?.d ?? Infinity), dataStore.get().trips);
        // A simulated time-lapse runs ahead of the wall clock; shift it back to real time.
        const shift = s.simulated ? clock.realOffset() : 0;
        const shifted = shift ? points.map((p) => ({ ...p, t: p.t + shift })) : points;
        trip = buildTripFromPoints(id, shifted, {
          startedAt: (s.startedAt ?? now) + shift,
          endedAt: now + shift,
          routeId: matches ? s.routeId : null,
          intendedRouteId: matches ? undefined : (s.routeId ?? undefined),
          laps,
          pauses: this.pauses.map((p) => ({ start: p.start + shift, end: p.end + shift })),
          duration,
          distance,
          simulated: s.simulated || undefined,
        });
        trip = await dataStore.saveTrip(trip, shifted, { match: !s.pendingRouteName && matches });
        if (s.pendingRouteName && !trip.routeId) {
          const route = await dataStore.createRouteFromTrip(trip, s.pendingRouteName);
          trip = dataStore.trip(trip.id) ?? { ...trip, routeId: route.id };
        }
      }
      this.reset();
      if (trip) this.feedback();
      return trip;
    } finally {
      this.finishing = false;
    }
  }

  async discard(): Promise<void> {
    this.reset();
  }

  private reset() {
    if (this.source instanceof SimulatedSource) this.source.reset();
    clock.reset();
    this.builder = new TrackBuilder();
    this.pauses = [];
    this.nextCheckpoint = 0;
    this.cpCandidate = null;
    this.finishCandidate = null;
    this.ghost?.reset();
    setKeepAwake(false);
    this.set({
      state: 'idle',
      sessionId: null,
      startedAt: null,
      activeSince: null,
      accumulated: 0,
      laps: [],
      lapStart: 0,
      lapStartDist: 0,
      distance: 0,
      trackVersion: this.snap.trackVersion + 1,
      ghost: null,
      lapFlash: null,
      pendingRouteName: null,
    });
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    void db.del('kv', 'session').catch(() => undefined);
    this.maybeStopSource();
    // Re-load the reference so the next drive on this route races it (it may have changed).
    void this.loadGhost();
  }

  private feedback() {
    if (settingsStore.get().hapticFeedback) haptic();
  }

  // ---- GPS -----------------------------------------------------------------
  private onFix(f: RawFix) {
    const now = clock.now();
    const prevSpeed = this.snap.speed;
    const rawSpeed = f.spd ?? (this.snap.fix ? this.impliedSpeed(this.snap.fix, f) : 0);
    const speed = prevSpeed * 0.35 + rawSpeed * 0.65;
    const gps: GpsStatus = f.acc <= 12 ? 'good' : f.acc <= 35 ? 'fair' : 'poor';
    const patch: Partial<RecorderSnapshot> = {
      fix: { ...f, receivedAt: now },
      speed: speed < 0.3 ? 0 : speed,
      heading: f.hdg ?? this.snap.heading,
      gps,
    };

    if (this.snap.state === 'recording' && !this.finishing && this.snap.activeSince != null && f.t >= this.snap.activeSince - 1500) {
      const e = this.snap.accumulated + Math.max(0, f.t - this.snap.activeSince);
      const p = this.builder.add(f, e);
      if (p) {
        patch.distance = this.builder.distance;
        patch.trackVersion = this.snap.trackVersion + 1;
        if (this.ghost) patch.ghost = this.ghost.update(p, e);
        this.set(patch);
        this.checkCheckpoints();
        this.checkFinish();
        this.schedulePersist();
        return;
      }
    }
    this.set(patch);
  }

  private impliedSpeed(a: RawFix, b: RawFix): number {
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) return this.snap.speed;
    return haversine(a, b) / dt;
  }

  /** Closest-approach detection on the latest GPS segment. Returns the candidate to keep. */
  private approach(target: { lat: number; lon: number }, radius: number, cand: Candidate | null): { cand: Candidate | null; passed: boolean } {
    const pts = this.builder.points;
    const b = pts[pts.length - 1];
    const a = pts[pts.length - 2];
    if (!a || !b || a.s !== b.s) return { cand, passed: false };
    const pr = projectOnSegment(target, a, b);
    if (pr.dist <= radius && (!cand || pr.dist < cand.dist)) {
      // Closer than before. If the closest point lies inside this segment we have already passed it;
      // if it is the segment's end (t = 1) we are still closing in.
      const next: Candidate = { e: lerp(a.e, b.e, pr.t), d: lerp(a.d, b.d, pr.t), dist: pr.dist };
      return { cand: next, passed: pr.t < 0.999 };
    }
    // Moving away again (or out of range) after having been close: passed.
    return { cand, passed: !!cand };
  }

  private checkCheckpoints() {
    const route = this.route;
    if (!route || !settingsStore.get().autoLap || this.nextCheckpoint >= route.checkpoints.length) return;
    const cp = route.checkpoints[this.nextCheckpoint];
    const r = this.approach(cp, CHECKPOINT_RADIUS, this.cpCandidate);
    this.cpCandidate = r.cand;
    if (r.passed && this.cpCandidate) {
      const c = this.cpCandidate;
      this.cpCandidate = null;
      this.nextCheckpoint++;
      this.addLap(c.e, c.d, cp.lat, cp.lon, true, cp.name ?? `Checkpoint ${this.nextCheckpoint}`);
    }
  }

  private checkFinish() {
    const route = this.route;
    if (!route || !settingsStore.get().autoFinish || this.finishing) return;
    const expected = this.snap.ghostRef?.distance ?? 0;
    if (this.builder.distance < Math.max(400, expected * 0.6)) return;
    const r = this.approach(route.end, 30, this.finishCandidate);
    this.finishCandidate = r.cand;
    const stoppedNearFinish = this.finishCandidate && this.snap.speed < 1;
    if ((r.passed || stoppedNearFinish) && this.finishCandidate) {
      if (settingsStore.get().voice) speak('Finish.');
      void this.finish().then((trip) => {
        if (trip) this.set({ autoFinished: { tripId: trip.id, at: Date.now() } });
      });
    }
  }

  // ---- persistence -----------------------------------------------------------
  private schedulePersist() {
    if (this.persistTimer) return;
    const wait = Math.max(0, 4000 - (Date.now() - this.lastPersist));
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, wait);
  }

  private async persist(force = false) {
    const s = this.snap;
    if (s.state === 'idle' || !s.sessionId || s.startedAt == null) return;
    if (!force && Date.now() - this.lastPersist < 3000) return;
    this.lastPersist = Date.now();
    const rec: PersistedSession = {
      key: 'session',
      id: s.sessionId,
      state: s.state,
      startedAt: s.startedAt,
      activeSince: s.activeSince,
      accumulated: s.accumulated,
      pauses: this.pauses,
      points: this.builder.points,
      laps: s.laps,
      lapStart: s.lapStart,
      lapStartDist: s.lapStartDist,
      segment: this.builder.segment,
      routeId: s.routeId,
      pendingRouteName: s.pendingRouteName,
      nextCheckpoint: this.nextCheckpoint,
      simulated: s.simulated,
    };
    try {
      await db.put('kv', rec);
    } catch {
      /* storage full or unavailable; keep recording in memory */
    }
  }
}

export const recorder = new Recorder();

export function useRecorder(): RecorderSnapshot {
  return useSyncExternalStore(recorder.subscribe, recorder.getSnapshot);
}

/** Text for the lap banner. */
export function lapFlashText(f: LapFlash): { title: string; time: string; delta: string | null } {
  return {
    title: f.auto ? `${f.label} · sector` : f.label,
    time: formatDuration(f.duration, 2),
    delta: f.delta != null ? `${formatDelta(f.delta)} vs ${f.against}` : null,
  };
}
