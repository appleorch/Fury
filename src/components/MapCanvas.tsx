import { useEffect, useRef, useState } from 'react';
import type { LatLon } from '../lib/types';
import { MapController } from './map';

/** Mounts a MapLibre map into a div and keeps its light/dark style in sync. */
export function useMapController(dark: boolean, opts: { interactive?: boolean; center?: LatLon; zoom?: number } = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ctl, setCtl] = useState<MapController | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const c = new MapController(ref.current, { dark, ...opts });
    setCtl(c);
    return () => {
      c.destroy();
      setCtl(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    ctl?.setDark(dark);
  }, [ctl, dark]);
  return { ref, ctl };
}
