import { ArrowUpDown, Flag, Loader2, LocateFixed, MapPin, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Marker } from 'maplibre-gl';
import { formatDistance, formatDurationWords } from '../lib/format';
import { reverseGeocode, searchPlaces } from '../lib/geocode';
import { planRoutes } from '../lib/routing';
import type { LatLon, Place, Route, RoutePlan } from '../lib/types';
import { dataStore, newId } from '../store/data';
import { useSettings } from '../store/settings';
import { addPin, MAP_CREDIT_HTML, pinElement, type MapController } from './map';
import { useMapController } from './MapCanvas';
import { Sheet } from './Sheet';
import { toast } from './Toast';
import { tap } from './ui';

interface Field {
  id: string;
  text: string;
  place: Place | null;
}

const emptyField = (): Field => ({ id: newId(), text: '', place: null });
const fieldFor = (p?: Place): Field => (p ? { id: newId(), text: p.title, place: p } : emptyField());

/**
 * Plan a route from addresses, like the directions card of a navigation app: From / To (and optional
 * stops) with search-as-you-type, a map preview and a choice of road routes.
 */
export function RoutePlannerSheet({
  position,
  route,
  dark,
  onSaved,
  onSkip,
  onClose,
}: {
  /** Current GPS position, for "Current location" and to bias search results. */
  position: LatLon | null;
  /** Edit this route's addresses instead of creating a new route. */
  route?: Route;
  dark: boolean;
  onSaved?: (route: Route) => void;
  /** Offer "name it now, set it from this drive" (Drive screen). */
  onSkip?: (name: string) => void;
  onClose: () => void;
}) {
  const { units } = useSettings();
  const [name, setName] = useState(route?.name ?? '');
  const [fields, setFields] = useState<Field[]>(() =>
    route?.from && route.to ? [fieldFor(route.from), ...(route.via ?? []).map(fieldFor), fieldFor(route.to)] : [emptyField(), emptyField()],
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [plans, setPlans] = useState<RoutePlan[]>(route?.plan ? [route.plan] : []);
  const [selected, setSelected] = useState(0);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const inputs = useRef(new Map<string, HTMLInputElement>());

  const active = fields.find((f) => f.id === activeId) ?? null;
  const places = fields.map((f) => f.place);
  const complete = places.every(Boolean);
  const placesKey = places.map((p) => (p ? `${p.lat.toFixed(5)},${p.lon.toFixed(5)}` : '-')).join(';');

  // Search as you type (debounced, cancels stale requests).
  useEffect(() => {
    if (!active || active.place || active.text.trim().length < 3) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    const t = setTimeout(() => {
      searchPlaces(active.text, position, ctrl.signal)
        .then((r) => {
          setResults(r);
          setSearchError(null);
        })
        .catch((e) => {
          if ((e as Error).name !== 'AbortError') setSearchError('Address search is unavailable. Check your connection.');
        })
        .finally(() => !ctrl.signal.aborted && setSearching(false));
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [active?.id, active?.text, active?.place]); // eslint-disable-line react-hooks/exhaustive-deps

  // Plan road routes once every field has a place.
  useEffect(() => {
    if (!complete) {
      setPlans([]);
      return;
    }
    if (route?.plan && placesKey === initialKey.current) return; // unchanged addresses: keep saved plan
    const ctrl = new AbortController();
    setPlanning(true);
    setPlanError(null);
    planRoutes(places as Place[], ctrl.signal)
      .then((p) => {
        setPlans(p);
        setSelected(0);
      })
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') {
          setPlans([]);
          setPlanError((e as Error).message);
        }
      })
      .finally(() => !ctrl.signal.aborted && setPlanning(false));
    return () => ctrl.abort();
  }, [placesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const initialKey = useRef(placesKey);

  const setField = (id: string, patch: Partial<Field>) => setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const choose = (id: string, place: Place) => {
    setField(id, { place, text: place.title });
    setResults([]);
    // Move on to the next empty field, like a navigation app.
    const next = fields.find((f) => f.id !== id && !f.place);
    if (next) {
      setActiveId(next.id);
      setTimeout(() => inputs.current.get(next.id)?.focus(), 50);
    } else {
      setActiveId(null);
      inputs.current.get(id)?.blur();
    }
  };

  const pickCurrentLocation = async (id: string) => {
    if (!position) return;
    const fallback: Place = { title: 'Current location', lat: position.lat, lon: position.lon };
    choose(id, fallback);
    const rev = await reverseGeocode(position);
    if (rev) setFields((fs) => fs.map((f) => (f.id === id && f.place === fallback ? { ...f, place: rev, text: rev.title } : f)));
  };

  const swap = () => setFields((fs) => [...fs].reverse());
  const addStop = () => {
    const f = emptyField();
    setFields((fs) => [...fs.slice(0, -1), f, fs[fs.length - 1]]);
    setActiveId(f.id);
    setTimeout(() => inputs.current.get(f.id)?.focus(), 50);
  };
  const removeStop = (id: string) => setFields((fs) => fs.filter((f) => f.id !== id));

  const from = fields[0].place;
  const to = fields[fields.length - 1].place;
  const suggestedName = from && to ? `${shortName(from)} → ${shortName(to)}` : '';
  const plan = plans[selected] ?? null;

  const save = async () => {
    if (!from || !to || !plan) return;
    setSaving(true);
    try {
      const via = fields.slice(1, -1).map((f) => f.place!) ;
      const data = { name: name.trim() || suggestedName, start: { lat: from.lat, lon: from.lon }, end: { lat: to.lat, lon: to.lon }, from, to, via, plan };
      let saved: Route;
      if (route) {
        saved = { ...route, ...data };
        await dataStore.saveRoute(saved);
        toast('Route updated');
      } else {
        saved = await dataStore.createRoute({ ...data, radius: 250, checkpoints: [] });
        toast(`Saved “${saved.name}”`);
      }
      onSaved?.(saved);
      setClosing(true);
    } finally {
      setSaving(false);
    }
  };

  // Close via the sheet's own animation once saved.
  useEffect(() => {
    if (closing) onClose();
  }, [closing, onClose]);

  return (
    <Sheet title={route ? 'Edit addresses' : 'New route'} onClose={onClose}>
      <input
        className="text-field"
        value={name}
        placeholder={suggestedName || 'Route name, e.g. Home → Work'}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        aria-label="Route name"
        style={{ marginBottom: 12 }}
      />

      <div className="planner-fields list">
        {fields.map((f, i) => {
          const role = i === 0 ? 'from' : i === fields.length - 1 ? 'to' : 'stop';
          return (
            <div key={f.id} className={`planner-field ${activeId === f.id ? 'active' : ''}`}>
              <span className={`planner-dot ${role}`} aria-hidden="true">
                {role === 'to' ? <Flag size={12} strokeWidth={2.8} /> : role === 'stop' ? i : null}
              </span>
              <input
                ref={(el) => {
                  if (el) inputs.current.set(f.id, el);
                  else inputs.current.delete(f.id);
                }}
                value={f.text}
                placeholder={role === 'from' ? 'From: address or place' : role === 'to' ? 'To: address or place' : 'Add a stop'}
                aria-label={role === 'from' ? 'Start address' : role === 'to' ? 'Destination address' : `Stop ${i}`}
                onFocus={() => setActiveId(f.id)}
                onChange={(e) => setField(f.id, { text: e.target.value, place: null })}
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
              {role === 'stop' ? (
                <button type="button" className="planner-x" aria-label="Remove stop" onClick={tap(() => removeStop(f.id))}>
                  <X size={16} />
                </button>
              ) : f.text ? (
                <button type="button" className="planner-x" aria-label="Clear" onClick={() => setField(f.id, { text: '', place: null })}>
                  <X size={16} />
                </button>
              ) : null}
            </div>
          );
        })}
        <button type="button" className="planner-swap glass" aria-label="Swap start and destination" onClick={tap(swap)}>
          <ArrowUpDown size={17} strokeWidth={2.4} />
        </button>
      </div>
      {fields.length < 5 && (
        <button type="button" className="planner-add" onClick={tap(addStop)}>
          <Plus size={17} strokeWidth={2.6} /> Add stop
        </button>
      )}

      {active && !active.place ? (
        <div className="list" style={{ marginTop: 10 }}>
          {position && (
            <button type="button" className="row" onClick={tap(() => void pickCurrentLocation(active.id))}>
              <span className="row-icon" style={{ background: 'var(--blue)' }}>
                <LocateFixed />
              </span>
              <span className="row-body">
                <div className="row-title">Current location</div>
              </span>
            </button>
          )}
          {results.map((p, i) => (
            <button key={i} type="button" className="row" style={{ '--inset': '58px' } as React.CSSProperties} onClick={tap(() => choose(active.id, p))}>
              <span className="row-icon" style={{ background: 'var(--red)' }}>
                <MapPin />
              </span>
              <span className="row-body">
                <div className="row-title">{p.title}</div>
                {p.subtitle && <div className="row-sub">{p.subtitle}</div>}
              </span>
            </button>
          ))}
          {searching && !results.length && (
            <div className="row muted">
              <Loader2 className="spin" size={18} /> Searching…
            </div>
          )}
          {!searching && active.text.trim().length >= 3 && !results.length && (
            <div className="row muted">{searchError ?? 'No matches. Try a street address or place name.'}</div>
          )}
          {active.text.trim().length < 3 && !position && (
            <div className="row muted">
              <Search size={18} /> Type an address or place
            </div>
          )}
        </div>
      ) : complete ? (
        <>
          <PlanMap places={places as Place[]} plans={plans} selected={selected} onSelect={setSelected} dark={dark} />
          {planning && (
            <div className="row muted" style={{ justifyContent: 'center' }}>
              <Loader2 className="spin" size={18} /> Finding routes…
            </div>
          )}
          {planError && <div className="insight" style={{ margin: '10px 0 0' }}>{planError}</div>}
          {!planning && plans.length > 0 && (
            <div className="plan-options">
              {plans.map((p, i) => (
                <button key={i} type="button" className={`plan-option ${i === selected ? 'on' : ''}`} onClick={tap(() => setSelected(i))}>
                  <div className="plan-time">{formatDurationWords(p.duration)}</div>
                  <div className="plan-meta">
                    {formatDistance(p.distance, units)}
                    {i === 0 && plans.length > 1 ? ' · Fastest' : ''}
                  </div>
                  {p.via && <div className="plan-via">via {p.via}</div>}
                </button>
              ))}
            </div>
          )}
          <p className="section-footer" style={{ padding: '10px 4px 0' }}>
            Drive time is a no-traffic estimate. Your drives on this route are matched by start and finish, so you can take any of these roads.
          </p>
        </>
      ) : null}

      <div className="sheet-actions" style={{ paddingTop: 14 }}>
        <button type="button" className="btn block primary" disabled={!plan || saving || planning} onClick={tap(() => void save())}>
          {route ? 'Save changes' : 'Save route'}
        </button>
        {onSkip && !route && (
          <button
            type="button"
            className="btn block secondary"
            onClick={tap(() => {
              onSkip(name.trim() || suggestedName || 'New route');
              onClose();
            })}
          >
            Skip addresses: use this drive's start and finish
          </button>
        )}
      </div>
      <p className="section-footer" style={{ padding: '10px 4px 0', fontSize: 12 }}>
        Address search by Photon and directions by OSRM, both using OpenStreetMap. Searches are sent to those services; nothing else leaves your phone.
      </p>
    </Sheet>
  );
}

function shortName(p: Place): string {
  return p.title.length > 22 ? `${p.title.slice(0, 20)}…` : p.title;
}

/** Map preview of the planned routes; tap an alternative to choose it. */
function PlanMap({ places, plans, selected, onSelect, dark }: { places: Place[]; plans: RoutePlan[]; selected: number; onSelect: (i: number) => void; dark: boolean }) {
  const { ref, ctl } = useMapController(dark, { interactive: true, center: places[0], zoom: 12 });
  const pins = useRef<Marker[]>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!ctl) return;
    ctl.layer({ id: 'plan-alt', type: 'line', source: 'plan-alt', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#8e8e93', 'line-opacity': 0.75, 'line-width': 6 } });
    ctl.layer({ id: 'plan-casing', type: 'line', source: 'plan-main', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0040dd', 'line-width': 9 } });
    ctl.layer({ id: 'plan-main', type: 'line', source: 'plan-main', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0a84ff', 'line-width': 6 } });
    const click = (e: { features?: { properties: { i: number } }[] }) => {
      const i = e.features?.[0]?.properties.i;
      if (i != null) onSelectRef.current(Number(i));
    };
    ctl.map.on('click', 'plan-alt', click as never);
    return () => {
      ctl.map.off('click', 'plan-alt', click as never);
    };
  }, [ctl]);

  const placesKey = useMemo(() => places.map((p) => `${p.lat},${p.lon}`).join(';'), [places]);
  useEffect(() => {
    if (!ctl) return;
    const line = (path: [number, number][], i: number): GeoJSON.Feature => ({
      type: 'Feature',
      properties: { i },
      geometry: { type: 'LineString', coordinates: path.map(([la, lo]) => [lo, la]) },
    });
    ctl.setData('plan-alt', { type: 'FeatureCollection', features: plans.map((p, i) => (i === selected ? null : line(p.path, i))).filter(Boolean) as GeoJSON.Feature[] });
    ctl.setData('plan-main', { type: 'FeatureCollection', features: plans[selected] ? [line(plans[selected].path, selected)] : [] });
  }, [ctl, plans, selected]);

  useEffect(() => {
    if (!ctl) return;
    pins.current.forEach((m) => m.remove());
    pins.current = places.map((p, i) => addPin(ctl, p, pinElement(i === 0 ? 'start' : i === places.length - 1 ? 'finish' : 'cp', String(i))));
    const all: LatLon[] = [...places, ...plans.flatMap((p) => p.path.map(([lat, lon]) => ({ lat, lon })))];
    fitAll(ctl, all);
  }, [ctl, placesKey, plans]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="map-card" style={{ height: 230, marginTop: 12 }}>
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
      <div className="map-credit" dangerouslySetInnerHTML={{ __html: MAP_CREDIT_HTML }} />
    </div>
  );
}

function fitAll(ctl: MapController, pts: LatLon[]) {
  if (pts.length === 1) ctl.map.jumpTo({ center: [pts[0].lon, pts[0].lat], zoom: 14 });
  else ctl.fit(pts, 36);
}
