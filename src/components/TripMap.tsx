import { Expand, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Marker } from 'maplibre-gl';
import { speedGradientCss } from '../lib/color';
import { speedUnit, speedValue } from '../lib/format';
import type { Checkpoint, Lap, LatLon, TrackPoint } from '../lib/types';
import { useSettings } from '../store/settings';
import { addPin, addTrackLayers, MAP_CREDIT_HTML, pathFeature, pinElement, setTrackPalette, trackFeatures, type MapController } from './map';
import { useMapController } from './MapCanvas';
import { GlassButton, tap } from './ui';

export interface TripMapProps {
  points: TrackPoint[];
  laps?: Lap[];
  checkpoints?: Checkpoint[];
  /** Plain path drawn under the track (e.g. a route's reference run). */
  refPath?: LatLon[];
  dark: boolean;
  onMapClick?: (p: LatLon, ctl: MapController) => void;
  onCheckpointClick?: (cp: Checkpoint) => void;
}

function useTripLayers(ctl: MapController | null, p: TripMapProps, padding: number) {
  const settings = useSettings();
  const pins = useRef<Marker[]>([]);
  const fitted = useRef(false);
  useEffect(() => {
    if (!ctl) return;
    addTrackLayers(ctl, settings.speedPalette);
  }, [ctl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ctl) setTrackPalette(ctl, settings.speedPalette);
  }, [ctl, settings.speedPalette]);
  useEffect(() => {
    if (!ctl) return;
    ctl.setData('trk-line', trackFeatures(p.points, settings.speedScaleMax));
    ctl.setData('trk-ref', pathFeature(p.refPath ?? []));
    pins.current.forEach((m) => m.remove());
    pins.current = [];
    const pts = p.points.length ? p.points : (p.refPath ?? []);
    if (pts.length) {
      pins.current.push(addPin(ctl, pts[0], pinElement('start')));
      pins.current.push(addPin(ctl, pts[pts.length - 1], pinElement('finish')));
    }
    for (const l of p.laps ?? []) {
      if (l.lat == null || l.lon == null || l.n === p.laps!.length) continue;
      pins.current.push(addPin(ctl, { lat: l.lat, lon: l.lon }, pinElement('lap', String(l.n))));
    }
    (p.checkpoints ?? []).forEach((cp, i) => {
      const el = pinElement('cp', String(i + 1));
      if (p.onCheckpointClick) {
        el.classList.add('removable');
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          p.onCheckpointClick!(cp);
        });
      }
      pins.current.push(addPin(ctl, cp, el));
    });
    if (!fitted.current && pts.length > 1) {
      fitted.current = true;
      ctl.fit(pts, padding);
    }
  }, [ctl, p.points, p.laps, p.checkpoints, p.refPath, settings.speedScaleMax]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ctl || !p.onMapClick) return;
    const h = (e: { lngLat: { lat: number; lng: number } }) => p.onMapClick!({ lat: e.lngLat.lat, lon: e.lngLat.lng }, ctl);
    ctl.map.on('click', h);
    return () => {
      ctl.map.off('click', h);
    };
  }, [ctl, p.onMapClick]);
}

export function SpeedLegend({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  const s = useSettings();
  return (
    <div className={`glass speed-legend ${className}`} style={style}>
      <span>0</span>
      <span className="bar" style={{ background: speedGradientCss(s.speedPalette) }} />
      <span>
        {Math.round(speedValue(s.speedScaleMax, s.units))} {speedUnit(s.units)}
      </span>
    </div>
  );
}

/** Map card for a trip or route, with a full-screen interactive view. */
export function TripMap(props: TripMapProps & { height?: number; interactive?: boolean }) {
  const [full, setFull] = useState(false);
  const { ref, ctl } = useMapController(props.dark, { interactive: props.interactive ?? false });
  useTripLayers(ctl, props, 36);
  return (
    <>
      <div className="map-card" style={{ height: props.height ?? 280 }}>
        <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
        <GlassButton icon={Expand} className="expand" onClick={tap(() => setFull(true))} ariaLabel="Full screen map" />
        {props.points.length > 1 && <SpeedLegend className="legend-in" />}
        <div className="map-credit" style={{ bottom: props.points.length > 1 ? 46 : 6 }} dangerouslySetInnerHTML={{ __html: MAP_CREDIT_HTML }} />
      </div>
      {full && <FullMap {...props} onClose={() => setFull(false)} />}
    </>
  );
}

function FullMap(props: TripMapProps & { onClose: () => void }) {
  const { ref, ctl } = useMapController(props.dark, { interactive: true });
  useTripLayers(ctl, props, 70);
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'var(--bg)' }} className="enter-fade">
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
      <div className="map-credit" style={{ bottom: 'calc(var(--safe-bottom) + 6px)' }} dangerouslySetInnerHTML={{ __html: MAP_CREDIT_HTML }} />
      <div style={{ position: 'absolute', top: 'calc(var(--safe-top) + 8px)', right: 12, zIndex: 5 }}>
        <GlassButton icon={X} onClick={tap(props.onClose)} ariaLabel="Close map" />
      </div>
      {props.points.length > 1 && (
        <SpeedLegend style={{ position: 'absolute', zIndex: 5, left: 12, bottom: 'calc(var(--safe-bottom) + 28px)', width: 210, padding: '8px 12px', borderRadius: 999 }} />
      )}
    </div>,
    document.body,
  );
}
