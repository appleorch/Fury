import { useSyncExternalStore } from 'react';
import { ROUTE_COLORS } from '../lib/color';
import { centroid } from '../lib/geo';
import { checkpointCrossings, checkpointsKey, DEFAULT_ROUTE_RADIUS, routeForDrive } from '../lib/routes';
import { generateSampleHistory } from '../lib/sample';
import type { Checkpoint, Route, TrackPoint, Trip } from '../lib/types';
import * as db from './db';

export interface DataState {
  ready: boolean;
  trips: Trip[];
  routes: Route[];
}

let state: DataState = { ready: false, trips: [], routes: [] };
const listeners = new Set<() => void>();
const trackCache = new Map<string, TrackPoint[]>();
const TRACK_CACHE_MAX = 12;

function emit(next: Partial<DataState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function sortTrips(trips: Trip[]): Trip[] {
  return [...trips].sort((a, b) => b.startedAt - a.startedAt);
}

function cacheTrack(id: string, points: TrackPoint[]) {
  trackCache.delete(id);
  trackCache.set(id, points);
  while (trackCache.size > TRACK_CACHE_MAX) trackCache.delete(trackCache.keys().next().value!);
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function withSectors(trip: Trip, route: Route | undefined, points: TrackPoint[]): Trip {
  if (!route || !route.checkpoints.length) return { ...trip, sectors: null };
  return { ...trip, sectors: { key: checkpointsKey(route.checkpoints), times: checkpointCrossings(points, route.checkpoints) } };
}

export const dataStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  async init(): Promise<void> {
    try {
      const [trips, routes] = await Promise.all([db.getAll<Trip>('trips'), db.getAll<Route>('routes')]);
      emit({ ready: true, trips: sortTrips(trips), routes: routes.sort((a, b) => a.createdAt - b.createdAt) });
    } catch (e) {
      // Private browsing or storage disabled: keep working in memory.
      console.error('Local database unavailable', e);
      emit({ ready: true });
    }
  },

  trip(id: string): Trip | undefined {
    return state.trips.find((t) => t.id === id);
  },

  route(id: string | null | undefined): Route | undefined {
    return id ? state.routes.find((r) => r.id === id) : undefined;
  },

  async getTrack(id: string): Promise<TrackPoint[]> {
    const hit = trackCache.get(id);
    if (hit) return hit;
    const rec = await db.get<{ id: string; points: TrackPoint[] }>('tracks', id);
    const pts = rec?.points ?? [];
    cacheTrack(id, pts);
    return pts;
  },

  /** Save a finished trip. If it has no route, try to match one by start and finish. */
  async saveTrip(trip: Trip, points: TrackPoint[], opts: { match?: boolean } = {}): Promise<Trip> {
    let t = trip;
    if (!t.routeId && opts.match !== false) {
      const r = routeForDrive(t.start, t.end, t.distance, state.routes, state.trips);
      if (r) t = { ...t, routeId: r.id };
    }
    t = withSectors(t, dataStore.route(t.routeId), points);
    await db.batch(['trips', 'tracks'], (s) => {
      s('trips').put(t);
      s('tracks').put({ id: t.id, points });
    });
    cacheTrack(t.id, points);
    emit({ trips: sortTrips([...state.trips.filter((x) => x.id !== t.id), t]) });
    return t;
  },

  async updateTrip(trip: Trip): Promise<void> {
    await db.put('trips', trip);
    emit({ trips: sortTrips(state.trips.map((t) => (t.id === trip.id ? trip : t))) });
  },

  async assignRoute(tripId: string, routeId: string | null): Promise<void> {
    const trip = dataStore.trip(tripId);
    if (!trip) return;
    const points = await dataStore.getTrack(tripId);
    await dataStore.updateTrip(withSectors({ ...trip, routeId, intendedRouteId: undefined }, dataStore.route(routeId), points));
  },

  async deleteTrip(id: string): Promise<void> {
    await db.batch(['trips', 'tracks'], (s) => {
      s('trips').delete(id);
      s('tracks').delete(id);
    });
    trackCache.delete(id);
    emit({ trips: state.trips.filter((t) => t.id !== id) });
  },

  /** Create a route from a trip's start/finish (and its lap points as checkpoints), assigning similar trips. */
  async createRouteFromTrip(trip: Trip, name: string, similar: Trip[] = []): Promise<Route> {
    const members = [trip, ...similar].filter((t) => t.start && t.end);
    const checkpoints: Checkpoint[] = trip.laps
      .filter((l) => l.lat != null && l.lon != null && l.n < trip.laps.length)
      .map((l) => ({ id: newId(), lat: l.lat!, lon: l.lon!, name: `Split ${l.n}` }));
    const route: Route = {
      id: newId(),
      name: name.trim() || 'Route',
      color: ROUTE_COLORS[state.routes.length % ROUTE_COLORS.length],
      start: centroid(members.map((t) => t.start!)),
      end: centroid(members.map((t) => t.end!)),
      radius: DEFAULT_ROUTE_RADIUS,
      checkpoints,
      createdAt: Date.now(),
    };
    await db.put('routes', route);
    emit({ routes: [...state.routes, route] });
    for (const t of members) await dataStore.assignRoute(t.id, route.id);
    return route;
  },

  async createRoute(partial: Omit<Route, 'id' | 'createdAt' | 'color'> & { color?: string }): Promise<Route> {
    const route: Route = {
      color: ROUTE_COLORS[state.routes.length % ROUTE_COLORS.length],
      ...partial,
      id: newId(),
      createdAt: Date.now(),
    };
    await db.put('routes', route);
    emit({ routes: [...state.routes, route] });
    return route;
  },

  /** Save route edits; recomputes sector times for its trips when checkpoints change. */
  async saveRoute(route: Route): Promise<void> {
    const prev = dataStore.route(route.id);
    await db.put('routes', route);
    emit({ routes: state.routes.map((r) => (r.id === route.id ? route : r)) });
    if (!prev || checkpointsKey(prev.checkpoints) !== checkpointsKey(route.checkpoints)) {
      for (const t of state.trips.filter((t) => t.routeId === route.id)) {
        const points = await dataStore.getTrack(t.id);
        const updated = withSectors(t, route, points);
        await db.put('trips', updated);
        state = { ...state, trips: state.trips.map((x) => (x.id === t.id ? updated : x)) };
      }
      emit({});
    }
  },

  async deleteRoute(id: string, deleteTrips = false): Promise<void> {
    const affected = state.trips.filter((t) => t.routeId === id);
    await db.batch(['routes', 'trips', 'tracks'], (s) => {
      s('routes').delete(id);
      for (const t of affected) {
        if (deleteTrips) {
          s('trips').delete(t.id);
          s('tracks').delete(t.id);
        } else s('trips').put({ ...t, routeId: null, sectors: null });
      }
    });
    const ids = new Set(affected.map((t) => t.id));
    emit({
      routes: state.routes.filter((r) => r.id !== id),
      trips: deleteTrips
        ? state.trips.filter((t) => !ids.has(t.id))
        : state.trips.map((t) => (ids.has(t.id) ? { ...t, routeId: null, sectors: null } : t)),
    });
  },

  hasSample(): boolean {
    return state.routes.some((r) => r.sample) || state.trips.some((t) => t.sample);
  },

  async loadSample(): Promise<void> {
    const { route, trips } = generateSampleHistory();
    await db.batch(['routes', 'trips', 'tracks'], (s) => {
      s('routes').put(route);
      for (const { trip, points } of trips) {
        s('trips').put(trip);
        s('tracks').put({ id: trip.id, points });
      }
    });
    emit({
      routes: [...state.routes.filter((r) => r.id !== route.id), route],
      trips: sortTrips([...state.trips.filter((t) => !t.sample), ...trips.map((t) => t.trip)]),
    });
  },

  async removeSample(): Promise<void> {
    const trips = state.trips.filter((t) => t.sample);
    const routes = state.routes.filter((r) => r.sample);
    await db.batch(['routes', 'trips', 'tracks'], (s) => {
      for (const r of routes) s('routes').delete(r.id);
      for (const t of trips) {
        s('trips').delete(t.id);
        s('tracks').delete(t.id);
      }
    });
    const sampleRouteIds = new Set(routes.map((r) => r.id));
    // Real trips that were matched to the sample route lose that link.
    const orphaned = state.trips.filter((t) => !t.sample && t.routeId && sampleRouteIds.has(t.routeId));
    for (const t of orphaned) await db.put('trips', { ...t, routeId: null, sectors: null });
    emit({
      routes: state.routes.filter((r) => !r.sample),
      trips: state.trips
        .filter((t) => !t.sample)
        .map((t) => (t.routeId && sampleRouteIds.has(t.routeId) ? { ...t, routeId: null, sectors: null } : t)),
    });
  },

  async exportAll(): Promise<Blob> {
    const tracks = await db.getAll<{ id: string; points: TrackPoint[] }>('tracks');
    const payload = {
      app: 'fury',
      version: 1,
      exportedAt: new Date().toISOString(),
      routes: state.routes.filter((r) => !r.sample),
      trips: state.trips.filter((t) => !t.sample),
      tracks: tracks.filter((t) => !t.id.startsWith('sample-')),
    };
    return new Blob([JSON.stringify(payload)], { type: 'application/json' });
  },

  async importAll(text: string): Promise<{ trips: number; routes: number }> {
    const data = JSON.parse(text);
    if (data?.app !== 'fury' || !Array.isArray(data.trips) || !Array.isArray(data.routes)) {
      throw new Error('This file is not a Fury backup.');
    }
    await db.batch(['routes', 'trips', 'tracks'], (s) => {
      for (const r of data.routes) s('routes').put(r);
      for (const t of data.trips) s('trips').put(t);
      for (const t of data.tracks ?? []) s('tracks').put(t);
    });
    await dataStore.init();
    return { trips: data.trips.length, routes: data.routes.length };
  },

  async clearAll(): Promise<void> {
    await db.clearAll();
    trackCache.clear();
    emit({ trips: [], routes: [] });
  },
};

export function useData(): DataState {
  return useSyncExternalStore(dataStore.subscribe, dataStore.get);
}
