import type { LatLon, Place } from './types';

/**
 * Address search with Photon (https://photon.komoot.io), a free OpenStreetMap geocoder that needs no
 * API key and is built for search-as-you-type. Results are biased towards `near` when given.
 */
const PHOTON = 'https://photon.komoot.io';

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    district?: string;
    locality?: string;
    state?: string;
    postcode?: string;
    country?: string;
    countrycode?: string;
    osm_value?: string;
  };
}

function toPlace(f: PhotonFeature): Place {
  const p = f.properties;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const title = p.name ?? (street || p.city || p.state || 'Unnamed place');
  const town = p.city ?? p.locality ?? p.district;
  const line2 = [p.name && street ? street : null, town, p.state, p.countrycode && p.countrycode !== 'US' ? p.country : null]
    .filter((x, i, a) => x && a.indexOf(x) === i)
    .join(', ');
  return { title, subtitle: line2 || undefined, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
}

export async function searchPlaces(query: string, near: LatLon | null, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const params = new URLSearchParams({ q, limit: '7' });
  if (near) {
    params.set('lat', near.lat.toFixed(4));
    params.set('lon', near.lon.toFixed(4));
  }
  const lang = (navigator.language || 'en').slice(0, 2);
  if (['en', 'de', 'fr'].includes(lang)) params.set('lang', lang);
  const res = await fetch(`${PHOTON}/api/?${params}`, { signal });
  if (!res.ok) throw new Error(`Address search failed (${res.status})`);
  const data = (await res.json()) as { features: PhotonFeature[] };
  const seen = new Set<string>();
  return data.features.map(toPlace).filter((p) => {
    const k = `${p.title}|${p.subtitle}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Nearest address to a coordinate, for labelling "Current location". */
export async function reverseGeocode(p: LatLon, signal?: AbortSignal): Promise<Place | null> {
  try {
    const res = await fetch(`${PHOTON}/reverse?lat=${p.lat.toFixed(6)}&lon=${p.lon.toFixed(6)}&limit=1`, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { features: PhotonFeature[] };
    return data.features[0] ? { ...toPlace(data.features[0]), lat: p.lat, lon: p.lon } : null;
  } catch {
    return null;
  }
}
