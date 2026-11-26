import { decodePolyline, simplifyTo } from './geo';
import type { LatLon, RoutePlan } from './types';

/**
 * Driving directions from the public OSRM server (https://project-osrm.org), free and key-less,
 * using OpenStreetMap roads. Returns the main route first, then up to two alternatives (OSRM only
 * offers alternatives when there are no stops in between).
 */
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

interface OsrmRoute {
  geometry: string;
  distance: number;
  duration: number;
  legs: { summary: string }[];
}

export async function planRoutes(points: LatLon[], signal?: AbortSignal): Promise<RoutePlan[]> {
  if (points.length < 2) return [];
  const coords = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const params = new URLSearchParams({ overview: 'full', geometries: 'polyline', steps: 'true', alternatives: points.length === 2 ? '2' : 'false' });
  const res = await fetch(`${OSRM}/${coords}?${params}`, { signal });
  const data = (await res.json().catch(() => null)) as { code: string; message?: string; routes?: OsrmRoute[] } | null;
  if (!res.ok || !data || data.code !== 'Ok' || !data.routes?.length) {
    throw new Error(data?.code === 'NoRoute' ? 'No driving route found between these places.' : 'Couldn’t plan a route right now. Check your connection and try again.');
  }
  return data.routes.map((r) => {
    const path = decodePolyline(r.geometry).map(([lat, lon]) => ({ lat, lon }));
    const roads = r.legs
      .flatMap((l) => l.summary.split(',').map((s) => s.trim()))
      .filter((s, i, a) => s && a.indexOf(s) === i)
      .slice(0, 3);
    return {
      path: simplifyTo(path, 500).map((p) => [p.lat, p.lon] as [number, number]),
      distance: r.distance,
      duration: r.duration * 1000,
      via: roads.join(', '),
    };
  });
}
