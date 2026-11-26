export interface LatLon {
  lat: number;
  lon: number;
}

/** One accepted GPS sample on a recorded track. */
export interface TrackPoint {
  /** Wall-clock timestamp, epoch ms. */
  t: number;
  /** Stopwatch time (active, excluding pauses) at this sample, ms. */
  e: number;
  lat: number;
  lon: number;
  /** Speed in m/s (device doppler speed when available, otherwise derived). */
  spd: number;
  /** Horizontal accuracy, metres. */
  acc: number;
  alt: number | null;
  hdg: number | null;
  /** Cumulative distance along the track, metres. */
  d: number;
  /** Segment number; increments after every pause so the map does not join across pauses. */
  s: number;
}

export interface Lap {
  /** 1-based lap number. */
  n: number;
  /** Stopwatch time at lap start / end, ms. */
  start: number;
  end: number;
  startDist: number;
  endDist: number;
  lat: number | null;
  lon: number | null;
  /** True when the lap was triggered automatically at a route checkpoint. */
  auto: boolean;
}

export interface PauseSpan {
  start: number;
  end: number;
}

export interface TripSummaryStats {
  movingTime: number;
  stoppedTime: number;
  stops: number;
  maxSpeed: number;
  avgSpeed: number;
  movingAvgSpeed: number;
  elevationGain: number | null;
}

/** Trip metadata kept in memory; the full track lives in a separate store. */
export interface Trip {
  id: string;
  startedAt: number;
  endedAt: number;
  routeId: string | null;
  title?: string;
  notes?: string;
  laps: Lap[];
  pauses: PauseSpan[];
  /** Stopwatch time, ms. */
  duration: number;
  /** Metres. */
  distance: number;
  start: LatLon | null;
  end: LatLon | null;
  stats: TripSummaryStats;
  /** Simplified polyline for thumbnails, [lat, lon][]. */
  preview: [number, number][];
  /** Cached sector times for the trip's route checkpoints. */
  sectors?: { key: string; times: (number | null)[] } | null;
  sample?: boolean;
  simulated?: boolean;
  /** Route that was selected while driving but whose start/finish this drive didn't match. */
  intendedRouteId?: string;
}

export interface Checkpoint extends LatLon {
  id: string;
  name?: string;
}

export interface Route {
  id: string;
  name: string;
  /** Accent hue (CSS color) shown next to the route name. */
  color: string;
  start: LatLon;
  end: LatLon;
  /** Matching radius for start and finish, metres. */
  radius: number;
  checkpoints: Checkpoint[];
  createdAt: number;
  sample?: boolean;
  /** Address of the start, when the route was planned from addresses. */
  from?: Place;
  /** Address of the finish. */
  to?: Place;
  /** Stops in between, in order. */
  via?: Place[];
  /** Road route planned between the addresses. */
  plan?: RoutePlan;
}

/** A searched address or point of interest. */
export interface Place extends LatLon {
  /** Main line, e.g. "1 Infinite Loop" or "Apple Park". */
  title: string;
  /** Secondary line, e.g. "Cupertino, CA". */
  subtitle?: string;
}

export interface RoutePlan {
  /** Simplified road geometry, [lat, lon][]. */
  path: [number, number][];
  /** Metres. */
  distance: number;
  /** Typical driving time without traffic, ms. */
  duration: number;
  /** Main roads, e.g. "I-280, Lawrence Expressway". */
  via: string;
}

export type Units = 'imperial' | 'metric';
