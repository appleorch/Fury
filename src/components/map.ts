import { Map as MLMap, Marker, LngLatBounds, setWorkerUrl, type GeoJSONSource, type AddLayerObject } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { speedColorExpression, type SpeedPalette } from '../lib/color';
import type { LatLon, TrackPoint } from '../lib/types';

setWorkerUrl(workerUrl);

/** Free, key-less vector tiles from OpenFreeMap (© OpenStreetMap contributors). */
export const STYLE_URLS = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

type FC = GeoJSON.FeatureCollection;
const EMPTY: FC = { type: 'FeatureCollection', features: [] };

export interface MapOpts {
  dark: boolean;
  interactive?: boolean;
  center?: LatLon;
  zoom?: number;
}

/**
 * Wraps a MapLibre map and re-applies our sources/layers whenever the base style changes
 * (light ↔ dark), so views can just declare what they want drawn.
 */
export class MapController {
  readonly map: MLMap;
  private dark: boolean;
  private data = new Map<string, FC>();
  private layers: { spec: AddLayerObject; top: boolean }[] = [];
  private styleReady = false;
  private destroyed = false;

  constructor(container: HTMLElement, opts: MapOpts) {
    this.dark = opts.dark;
    this.map = new MLMap({
      container,
      style: STYLE_URLS[opts.dark ? 'dark' : 'light'],
      center: opts.center ? [opts.center.lon, opts.center.lat] : [-98.5, 39.8],
      zoom: opts.zoom ?? (opts.center ? 14 : 3),
      interactive: opts.interactive ?? true,
      attributionControl: false,
      maplibreLogo: false,
      touchPitch: false,
      pitchWithRotate: false,
      fadeDuration: 150,
      maxPitch: 60,
      dragRotate: true,
      clickTolerance: 6,
    });
    this.map.on('style.load', () => this.applyAll());
    // Missing sprite images in third-party styles are harmless; silence the console noise.
    this.map.on('styleimagemissing', () => undefined);
    this.map.on('error', (e) => {
      if (!/Failed to fetch|NetworkError|AbortError/.test(String(e.error?.message ?? ''))) console.warn('[map]', e.error?.message);
    });
  }

  /** Our lines go above every road/area layer but below the labels that come after them. */
  private firstSymbolLayer(): string | undefined {
    const layers = this.map.getStyle()?.layers ?? [];
    let lastShape = -1;
    layers.forEach((l, i) => {
      if (l.type !== 'symbol' && !l.id.startsWith('trk-')) lastShape = i;
    });
    return layers.slice(lastShape + 1).find((l) => l.type === 'symbol')?.id;
  }

  private applyAll() {
    if (this.destroyed) return;
    this.styleReady = true;
    for (const [id, fc] of this.data) {
      if (!this.map.getSource(id)) this.map.addSource(id, { type: 'geojson', data: fc, lineMetrics: false });
    }
    for (const { spec, top } of this.layers) this.addLayer(spec, top);
  }

  private addLayer(spec: AddLayerObject, top: boolean) {
    if (this.map.getLayer(spec.id)) return;
    if ('source' in spec && typeof spec.source === 'string' && !this.map.getSource(spec.source)) return;
    this.map.addLayer(spec, top ? undefined : this.firstSymbolLayer());
  }

  setDark(dark: boolean) {
    if (dark === this.dark) return;
    this.dark = dark;
    this.styleReady = false;
    this.map.setStyle(STYLE_URLS[dark ? 'dark' : 'light']);
  }

  setData(id: string, fc: FC) {
    this.data.set(id, fc);
    if (!this.styleReady) return;
    const src = this.map.getSource(id) as GeoJSONSource | undefined;
    if (src) src.setData(fc);
    else {
      this.map.addSource(id, { type: 'geojson', data: fc });
      for (const { spec, top } of this.layers) if ('source' in spec && spec.source === id) this.addLayer(spec, top);
    }
  }

  /** Declare a layer; `top` puts it above map labels. */
  layer(spec: AddLayerObject, top = false) {
    if (this.layers.some((l) => l.spec.id === spec.id)) return;
    this.layers.push({ spec, top });
    if ('source' in spec && typeof spec.source === 'string' && !this.data.has(spec.source)) this.setData(spec.source, EMPTY);
    if (this.styleReady) this.addLayer(spec, top);
  }

  setPaint(layerId: string, prop: string, value: unknown) {
    const l = this.layers.find((x) => x.spec.id === layerId);
    if (l && 'paint' in l.spec) (l.spec.paint as Record<string, unknown>)[prop] = value;
    if (this.styleReady && this.map.getLayer(layerId)) this.map.setPaintProperty(layerId, prop as never, value as never);
  }

  fit(points: LatLon[], padding: number | { top: number; bottom: number; left: number; right: number } = 40, animate = false) {
    if (!points.length) return;
    const b = new LngLatBounds();
    for (const p of points) b.extend([p.lon, p.lat]);
    this.map.fitBounds(b, { padding, animate, duration: animate ? 800 : 0, maxZoom: 16, bearing: 0, pitch: 0 });
  }

  destroy() {
    this.destroyed = true;
    this.map.remove();
  }
}

/** Track as line features grouped by quantised speed, so the line can be coloured by speed. */
export function trackFeatures(points: TrackPoint[], speedMax: number, steps = 24): FC {
  const features: GeoJSON.Feature[] = [];
  if (points.length < 2) return { type: 'FeatureCollection', features };
  const q = (v: number) => Math.round(Math.max(0, Math.min(1, v / speedMax)) * steps) / steps;
  let coords: [number, number][] = [[points[0].lon, points[0].lat]];
  let bucket = q(points[0].spd);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.s !== b.s) {
      if (coords.length > 1) features.push(line(coords, bucket));
      coords = [[b.lon, b.lat]];
      bucket = q(b.spd);
      continue;
    }
    const v = q((a.spd + b.spd) / 2);
    if (v !== bucket && coords.length > 1) {
      features.push(line(coords, bucket));
      coords = [[a.lon, a.lat]];
    }
    bucket = v;
    coords.push([b.lon, b.lat]);
  }
  if (coords.length > 1) features.push(line(coords, bucket));
  return { type: 'FeatureCollection', features };
}

function line(coords: [number, number][], v: number): GeoJSON.Feature {
  return { type: 'Feature', properties: { v }, geometry: { type: 'LineString', coordinates: coords } };
}

export function pathFeature(points: LatLon[]): FC {
  return {
    type: 'FeatureCollection',
    features: points.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map((p) => [p.lon, p.lat]) } }] : [],
  };
}

const widthByZoom = (base: number) => ['interpolate', ['linear'], ['zoom'], 8, base * 0.45, 13, base * 0.8, 16, base, 19, base * 1.7];

/** Adds the reference path + speed-coloured track layers. */
export function addTrackLayers(ctl: MapController, palette: SpeedPalette, prefix = 'trk') {
  ctl.layer({
    id: `${prefix}-ref`,
    type: 'line',
    source: `${prefix}-ref`,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#0a84ff', 'line-opacity': 0.28, 'line-width': widthByZoom(12) as never },
  });
  ctl.layer({
    id: `${prefix}-casing`,
    type: 'line',
    source: `${prefix}-line`,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#000000', 'line-opacity': 0.22, 'line-width': widthByZoom(10) as never },
  });
  ctl.layer({
    id: `${prefix}-speed`,
    type: 'line',
    source: `${prefix}-line`,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': speedColorExpression(palette) as never, 'line-width': widthByZoom(6.5) as never },
  });
}

export function setTrackPalette(ctl: MapController, palette: SpeedPalette, prefix = 'trk') {
  ctl.setPaint(`${prefix}-speed`, 'line-color', speedColorExpression(palette));
}

export function pinElement(kind: 'start' | 'finish' | 'lap' | 'cp', text?: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `map-pin ${kind}`;
  if (kind === 'start') el.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  else if (kind === 'finish')
    el.innerHTML =
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3h2v18H5zM8 4h11l-2.5 4L19 12H8z"/></svg>';
  else el.textContent = text ?? '';
  return el;
}

export function addPin(ctl: MapController, at: LatLon, el: HTMLElement): Marker {
  return new Marker({ element: el, anchor: 'center' }).setLngLat([at.lon, at.lat]).addTo(ctl.map);
}

export function puckElement(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'puck';
  el.innerHTML = '<div class="halo"></div><div class="cone"></div><div class="core"></div>';
  return el;
}

export { Marker };

export const MAP_CREDIT_HTML =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> · ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>';
