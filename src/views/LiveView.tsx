import {
  ChevronDown,
  Compass,
  Flag,
  LocateFixed,
  Navigation,
  Pause,
  Play,
  Scan,
  Share,
  Signpost,
  Timer,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Marker } from 'maplibre-gl';
import { speedColorExpression, speedGradientCss } from '../lib/color';
import { clock } from '../lib/clock';
import { isIOS, isStandalone } from '../lib/device';
import { distanceUnit, formatClock, formatDelta, formatDistanceValue, formatDuration, formatSpeed, speedUnit, speedValue } from '../lib/format';
import { simplifyTo } from '../lib/geo';
import { navigate } from '../hooks/router';
import { dataStore, useData } from '../store/data';
import { lapFlashText, recorder, useRecorder, type RecorderSnapshot } from '../store/recorder';
import { settingsStore, useSettings } from '../store/settings';
import { useMapController } from '../components/MapCanvas';
import { FollowAnimator } from '../components/follow';
import { addPin, addTrackLayers, MAP_CREDIT_HTML, pathFeature, pinElement, puckElement, setTrackPalette, trackFeatures, Marker as MLMarker } from '../components/map';
import { RoutePickerSheet } from '../components/RoutePicker';
import { ConfirmSheet, Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { TrackThumb } from '../components/charts';
import { Ticker } from '../components/Ticker';
import { tap } from '../components/ui';

const zoomForSpeed = (mps: number) => (mps > 26 ? 14.4 : mps > 17 ? 15 : mps > 8 ? 15.8 : 16.4);

export function LiveView({ active, dark }: { active: boolean; dark: boolean }) {
  const rec = useRecorder();
  const settings = useSettings();
  const { trips, routes } = useData();
  const lastTrip = trips[0];
  const initialCenter = useMemo(() => lastTrip?.end ?? routes[0]?.start ?? undefined, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { ref: mapRef, ctl } = useMapController(dark, { center: initialCenter, zoom: initialCenter ? 14 : 3 });
  const [follow, setFollow] = useState(true);
  const [picker, setPicker] = useState(false);
  const [lapsOpen, setLapsOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(() => localStorage.getItem('fury.installHint') === '1');
  const hudRef = useRef<HTMLDivElement>(null);
  const puckRef = useRef<Marker | null>(null);
  const pinsRef = useRef<Marker[]>([]);
  const animRef = useRef<FollowAnimator | null>(null);
  const tipFrom = useRef<{ lat: number; lon: number; v: number } | null>(null);
  const lastTipAt = useRef(0);
  const route = dataStore.route(rec.routeId);
  const recording = rec.state === 'recording';
  const idle = rec.state === 'idle';

  // Listen to GPS while this screen is visible (recording keeps it alive on its own).
  useEffect(() => {
    if (!active && idle) return;
    return recorder.acquire();
  }, [active, idle]);

  // Map layers + puck
  useEffect(() => {
    if (!ctl) return;
    addTrackLayers(ctl, settingsStore.get().speedPalette);
    if (import.meta.env.DEV || location.search.includes('debug')) (window as unknown as { __furyMap: unknown }).__furyMap = ctl.map;
    const el = puckElement();
    puckRef.current = new MLMarker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' });
    // The last stretch of the line is drawn up to the animated puck so the line never runs ahead of it.
    ctl.layer({
      id: 'trk-tip-casing',
      type: 'line',
      source: 'trk-tip',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#000000', 'line-opacity': 0.22, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4.5, 13, 8, 16, 10, 19, 17] as never },
    });
    ctl.layer({
      id: 'trk-tip',
      type: 'line',
      source: 'trk-tip',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': speedColorExpression(settingsStore.get().speedPalette) as never,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.9, 13, 5.2, 16, 6.5, 19, 11] as never,
      },
    });
    animRef.current = new FollowAnimator(ctl.map, puckRef.current, () => clock.now(), (pos) => {
      const from = tipFrom.current;
      const now = performance.now();
      if (now - lastTipAt.current < 33) return;
      lastTipAt.current = now;
      ctl.setData('trk-tip', {
        type: 'FeatureCollection',
        features: from
          ? [{ type: 'Feature', properties: { v: from.v }, geometry: { type: 'LineString', coordinates: [[from.lon, from.lat], [pos.lon, pos.lat]] } }]
          : [],
      });
    });
    const stopFollow = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) setFollow(false);
    };
    ctl.map.on('dragstart', stopFollow);
    ctl.map.on('rotatestart', stopFollow);
    ctl.map.on('zoomstart', stopFollow);
    return () => {
      animRef.current?.destroy();
      animRef.current = null;
      puckRef.current?.remove();
      puckRef.current = null;
    };
  }, [ctl]);

  useEffect(() => {
    if (!ctl) return;
    setTrackPalette(ctl, settings.speedPalette);
    ctl.setPaint('trk-tip', 'line-color', speedColorExpression(settings.speedPalette));
  }, [ctl, settings.speedPalette]);

  useEffect(() => {
    if (active && ctl) requestAnimationFrame(() => ctl.map.resize());
  }, [active, ctl]);

  // Live track: everything up to the second-to-last point; the animated tip draws the rest.
  // Rebuilding the whole line is throttled so fast Simulation doesn't flood the map.
  const trackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTrackAt = useRef(0);
  useEffect(() => {
    if (!ctl) return;
    const draw = () => {
      trackTimer.current = null;
      lastTrackAt.current = performance.now();
      const pts = recorder.points();
      const live = recorder.getSnapshot().state === 'recording' && pts.length >= 2;
      ctl.setData('trk-line', trackFeatures(live ? pts.slice(0, -1) : pts, settingsStore.get().speedScaleMax));
      const a = live ? pts[pts.length - 2] : null;
      tipFrom.current = a ? { lat: a.lat, lon: a.lon, v: Math.min(1, (a.spd + pts[pts.length - 1].spd) / 2 / settingsStore.get().speedScaleMax) } : null;
      if (!live) ctl.setData('trk-tip', pathFeature([]));
    };
    const wait = 250 - (performance.now() - lastTrackAt.current);
    if (wait <= 0) draw();
    else if (!trackTimer.current) trackTimer.current = setTimeout(draw, wait);
  }, [ctl, rec.trackVersion, rec.state, settings.speedScaleMax]);
  useEffect(() => () => {
    if (trackTimer.current) clearTimeout(trackTimer.current);
  }, []);

  // Reference path for the selected route + start/finish/checkpoint pins
  useEffect(() => {
    if (!ctl) return;
    let cancelled = false;
    pinsRef.current.forEach((m) => m.remove());
    pinsRef.current = [];
    if (!route) {
      ctl.setData('trk-ref', pathFeature([]));
      return;
    }
    pinsRef.current.push(addPin(ctl, route.end, pinElement('finish')));
    route.checkpoints.forEach((cp, i) => pinsRef.current.push(addPin(ctl, cp, pinElement('cp', String(i + 1)))));
    if (rec.ghostRef) {
      void dataStore.getTrack(rec.ghostRef.tripId).then((pts) => {
        if (!cancelled) ctl.setData('trk-ref', pathFeature(simplifyTo(pts, 600)));
      });
    } else ctl.setData('trk-ref', pathFeature((route.plan?.path ?? []).map(([lat, lon]) => ({ lat, lon }))));
    return () => {
      cancelled = true;
    };
  }, [ctl, route, rec.ghostRef]);

  // Feed GPS fixes to the animator; it moves the puck and camera smoothly every frame.
  useEffect(() => {
    const f = rec.fix;
    const anim = animRef.current;
    if (!ctl || !f || !anim || !puckRef.current) return;
    if (!puckRef.current.getElement().isConnected) puckRef.current.setLngLat([f.lon, f.lat]).addTo(ctl.map);
    anim.push({ t: f.t, lat: f.lat, lon: f.lon, hdg: f.hdg ?? rec.heading, speed: f.spd ?? rec.speed });
  }, [ctl, rec.fix, rec.heading, rec.speed]);

  // Camera goals: follow on/off, heading-up, zoom by speed, tilt while driving.
  const zoomBucket = idle ? 16 : zoomForSpeed(rec.speed);
  useEffect(() => {
    const anim = animRef.current;
    if (!ctl || !anim) return;
    anim.active = active;
    anim.setGoal({ follow, headingUp: settings.headingUp, zoom: zoomBucket, pitch: settings.headingUp && !idle ? 45 : 0 });
  }, [ctl, active, follow, settings.headingUp, zoomBucket, idle]);

  // Keep the puck in the visible gap between the top controls and the HUD.
  useEffect(() => {
    if (!ctl) return;
    const apply = () => {
      const hud = hudRef.current?.getBoundingClientRect().height ?? 300;
      ctl.map.setPadding({ top: 130, bottom: Math.min(hud + 30, window.innerHeight * 0.6), left: 20, right: 20 });
    };
    apply();
    const ro = new ResizeObserver(apply);
    if (hudRef.current) ro.observe(hudRef.current);
    return () => ro.disconnect();
  }, [ctl]);

  // Auto-finish → summary
  useEffect(() => {
    if (rec.autoFinished && Date.now() - rec.autoFinished.at < 5000) navigate(`/trip/${rec.autoFinished.tripId}?new=1`);
  }, [rec.autoFinished]);

  const fitTrack = () => {
    if (!ctl) return;
    const pts = recorder.points();
    if (pts.length < 2) return;
    setFollow(false);
    const hud = hudRef.current?.getBoundingClientRect().height ?? 300;
    ctl.fit(pts, { top: 130, bottom: hud + 40, left: 40, right: 70 }, true);
  };

  const recenter = () => {
    setFollow(true);
    animRef.current?.snap();
  };

  const finish = async () => {
    const trip = await recorder.finish();
    if (trip) navigate(`/trip/${trip.id}?new=1`);
    else toast('Too short to save', 'info');
  };

  const showInstallHint = idle && !hintDismissed && isIOS() && !isStandalone();

  return (
    <div className="live">
      <div ref={mapRef} className="map-fill" />

      <div className="live-top">
        <div className="live-top-left">
          <button type="button" className="glass glass-btn route-pill" onClick={tap(() => setPicker(true))}>
            {route ? <span className="dot" style={{ background: route.color }} /> : <Signpost style={{ color: 'var(--label)' }} />}
            <span className="route-name">{route?.name ?? (rec.pendingRouteName ? `New: ${rec.pendingRouteName}` : 'Free drive')}</span>
            <ChevronDown strokeWidth={2.6} />
          </button>
          <GhostPill rec={rec} />
        </div>
        <GpsPill rec={rec} />
      </div>

      <div className="glass map-controls" style={{ top: 'calc(var(--safe-top) + 60px)' }}>
        <button type="button" className={follow ? 'on' : ''} onClick={tap(recenter)} aria-label="Follow my location">
          {follow ? <Navigation fill="currentColor" /> : <LocateFixed />}
        </button>
        <button
          type="button"
          className={settings.headingUp ? 'on' : ''}
          onClick={tap(() => {
            settingsStore.set({ headingUp: !settings.headingUp });
            if (settings.headingUp && ctl) ctl.map.easeTo({ bearing: 0, pitch: 0, duration: 500 });
            toast(settings.headingUp ? 'North up' : 'Heading up', 'info', 1200);
          })}
          aria-label="Toggle heading up"
        >
          <Compass />
        </button>
        <button type="button" onClick={tap(fitTrack)} aria-label="Show whole drive">
          <Scan />
        </button>
      </div>

      {rec.lapFlash && clock.now() - rec.lapFlash.at < 4200 && <LapBanner key={rec.lapFlash.at} rec={rec} />}

      <div className={`hud-wrap ${recording ? '' : 'with-tabs'}`}>
        {rec.gps === 'denied' && (
          <div className="glass install-hint" role="alert">
            <LocateFixed />
            <div style={{ flex: 1 }}>
              <b>Location access is off.</b> On iPhone open <b>Settings → Privacy & Security → Location Services → Safari Websites</b>, choose{' '}
              <b>While Using the App</b> and turn on <b>Precise Location</b>, then reopen Fury.
            </div>
          </div>
        )}
        {rec.simulated && idle && (
          <div className="glass install-hint">
            <Signpost style={{ color: 'var(--orange)' }} />
            <div style={{ flex: 1 }}>
              <b>Simulation mode is on.</b> Hit record to watch a demo commute. Turn it off in Settings to use real GPS.
            </div>
          </div>
        )}
        {showInstallHint && !rec.simulated && (
          <div className="glass install-hint">
            <Share />
            <div style={{ flex: 1 }}>
              <b>Install Fury on your iPhone.</b> Tap <b>Share</b>, then <b>Add to Home Screen</b> for a full-screen app that keeps your data.
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                localStorage.setItem('fury.installHint', '1');
                setHintDismissed(true);
              }}
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="hud-aux">
          {!idle && recorder.points().length > 1 ? (
            <div className="glass speed-legend" style={{ padding: '7px 12px', borderRadius: 999, width: 190, flex: 'none' }}>
              <span>0</span>
              <span className="bar" style={{ background: speedGradientCss(settings.speedPalette) }} />
              <span>
                {Math.round(speedValue(settings.speedScaleMax, settings.units))} {speedUnit(settings.units)}
              </span>
            </div>
          ) : (
            <span />
          )}
          <div className="live-credit" dangerouslySetInnerHTML={{ __html: MAP_CREDIT_HTML }} />
        </div>
        <Hud
          hudRef={hudRef}
          rec={rec}
          lastTrip={lastTrip}
          onFinish={finish}
          onDiscard={() => setConfirmDiscard(true)}
          onRoute={() => setPicker(true)}
          onLaps={() => setLapsOpen(true)}
        />
      </div>

      {picker && (
        <RoutePickerSheet
          position={rec.fix}
          selectedId={rec.routeId}
          pendingName={rec.pendingRouteName}
          onSelect={(id) => void recorder.setRoute(id)}
          onNew={(name) => recorder.setPendingRoute(name)}
          dark={dark}
          onClose={() => setPicker(false)}
        />
      )}
      {lapsOpen && <LapsSheet rec={rec} onClose={() => setLapsOpen(false)} />}
      {confirmDiscard && (
        <ConfirmSheet
          title="Discard this drive?"
          message="The timer, laps and track recorded so far will be deleted."
          confirmLabel="Discard drive"
          destructive
          onConfirm={() => recorder.discard()}
          onClose={() => setConfirmDiscard(false)}
        />
      )}
    </div>
  );
}

function GpsPill({ rec }: { rec: RecorderSnapshot }) {
  const acc = rec.fix?.acc;
  const bars = rec.gps === 'good' ? 4 : rec.gps === 'fair' ? 3 : rec.gps === 'poor' ? 1 : 0;
  const text =
    rec.gps === 'denied'
      ? 'No access'
      : rec.gps === 'unavailable'
        ? 'No GPS'
        : rec.gps === 'searching' || rec.gps === 'off'
          ? 'GPS…'
          : acc != null
            ? `±${Math.round(acc)} m`
            : 'GPS';
  return (
    <div className="glass gps-pill" aria-label={`GPS ${text}`}>
      {rec.simulated && <span className="sim-badge">SIM</span>}
      <span className="gps-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <i key={i} className={i <= bars ? 'on' : ''} />
        ))}
      </span>
      <span className="num">{text}</span>
    </div>
  );
}

function GhostPill({ rec }: { rec: RecorderSnapshot }) {
  if (rec.state === 'idle' || !rec.ghostRef) return null;
  const g = rec.ghost;
  if (!g || g.delta == null) {
    return (
      <div className="glass ghost-pill off">
        <div className="ghost-sub">Racing your {rec.ghostRef.label}</div>
        <div className="delta" style={{ fontSize: 20 }}>
          {formatDuration(rec.ghostRef.duration, 1)}
        </div>
      </div>
    );
  }
  const ahead = g.delta < 0;
  const Icon = ahead ? TrendingDown : TrendingUp;
  const eta = g.predicted != null ? formatClock(Date.now() + Math.max(0, g.predicted - recorder.elapsed()) / clock.rate) : null;
  return (
    <div className={`glass ghost-pill ${g.offRoute ? 'off' : ''}`} aria-live="polite">
      <div className={`delta ${ahead ? 'faster' : 'slower'}`}>
        <Icon strokeWidth={2.8} />
        {formatDelta(g.delta)}
      </div>
      <div className="ghost-sub">
        {g.offRoute ? 'Off route' : `vs ${rec.ghostRef.label}`}
        {!g.offRoute && g.predicted != null ? ` · finish ${formatDuration(g.predicted, 0)}` : ''}
        {!g.offRoute && eta && rec.state === 'recording' && !rec.simulated ? ` · ${eta}` : ''}
      </div>
    </div>
  );
}

function LapBanner({ rec }: { rec: RecorderSnapshot }) {
  const f = rec.lapFlash!;
  const t = lapFlashText(f);
  return (
    <div className="lap-banner-wrap" role="status" aria-live="assertive">
      <div className="glass strong lap-banner">
        <div className="t1">{t.title}</div>
        <div className="t2">{t.time}</div>
        {t.delta && f.delta != null && <div className={`t3 ${f.delta < 0 ? 'faster' : 'slower'}`}>{t.delta}</div>}
      </div>
    </div>
  );
}

function Hud({
  hudRef,
  rec,
  lastTrip,
  onFinish,
  onDiscard,
  onRoute,
  onLaps,
}: {
  hudRef: React.RefObject<HTMLDivElement | null>;
  rec: RecorderSnapshot;
  lastTrip?: ReturnType<typeof dataStore.trip>;
  onFinish: () => void;
  onDiscard: () => void;
  onRoute: () => void;
  onLaps: () => void;
}) {
  const { units } = useSettings();
  const idle = rec.state === 'idle';
  const recording = rec.state === 'recording';
  const lapNo = rec.laps.length + 1;
  const elapsedNow = recorder.elapsed();
  const avg = elapsedNow > 2000 ? rec.distance / (elapsedNow / 1000) : 0;
  const lapTimes = rec.laps.map((l) => l.end - l.start);
  const bestLap = lapTimes.length > 1 ? Math.min(...lapTimes) : null;
  const recent = rec.laps.slice(-2).reverse();

  return (
    <div ref={hudRef} className="glass hud">
      <div className="hud-head">
        <span>
          <span className={`status-dot ${recording ? 'rec' : rec.state === 'paused' ? 'paused' : ''}`} />
          {idle ? 'Ready' : rec.state === 'paused' ? `Paused · Lap ${lapNo}` : `Lap ${lapNo}`}
        </span>
        {!idle ? (
          <span className="total">
            <span>Total</span>
            <Ticker running={recording} render={(now) => formatDuration(recorder.elapsed(now), 1)} />
          </span>
        ) : (
          <span style={{ textTransform: 'none', letterSpacing: 0 }}>
            {rec.gps === 'denied' ? 'Location is off' : rec.simulated ? 'Simulation' : rec.fix ? 'GPS ready' : 'Finding GPS…'}
          </span>
        )}
      </div>

      <div className={`lap-time ${idle ? 'dim' : ''}`} aria-label="Current lap time">
        <LapClock rec={rec} />
      </div>

      <div className="hud-metrics">
        <div className="metric">
          <div className="metric-value">{formatSpeed(rec.speed, units)}</div>
          <div className="metric-label">{speedUnit(units)}</div>
        </div>
        <div className="metric">
          <div className="metric-value">{formatDistanceValue(rec.distance, units)}</div>
          <div className="metric-label">{distanceUnit(units)}</div>
        </div>
        <div className="metric">
          <div className="metric-value">{idle ? '–' : formatSpeed(avg, units)}</div>
          <div className="metric-label">avg {speedUnit(units)}</div>
        </div>
      </div>

      {idle ? (
        <div className="hud-idle-row">
          <div className="hud-idle-side">
            <button type="button" className="round-btn neutral" onClick={tap(onRoute)} aria-label="Choose route">
              <span className="label">
                <Signpost />
                Route
              </span>
            </button>
          </div>
          <button type="button" className="record-btn" aria-label="Start recording" onClick={() => recorder.start()} disabled={rec.gps === 'denied'} />
          <div className="hud-idle-side">
            {lastTrip ? (
              <button type="button" onClick={tap(() => navigate(`/trip/${lastTrip.id}`))} aria-label="Last drive" style={{ display: 'grid', justifyItems: 'center', gap: 4 }}>
                <TrackThumb preview={lastTrip.preview} size={56} color={dataStore.route(lastTrip.routeId)?.color} />
                <span style={{ fontSize: 12, color: 'var(--label-2)', fontWeight: 600 }}>Last drive</span>
              </button>
            ) : (
              <span style={{ width: 80 }} />
            )}
          </div>
        </div>
      ) : (
        <div className="hud-controls">
          {recording ? (
            <button type="button" className="round-btn neutral" onClick={() => recorder.lap()} aria-label="Lap">
              <span className="label">
                <Timer />
                Lap
              </span>
            </button>
          ) : (
            <button type="button" className="round-btn stop" onClick={onFinish} aria-label="Finish drive">
              <span className="label">
                <Flag />
                Finish
              </span>
            </button>
          )}
          {!recording && (
            <button type="button" className="btn small secondary" onClick={tap(onDiscard)} style={{ color: 'var(--label-2)' }}>
              Discard
            </button>
          )}
          {recording && rec.laps.length > 0 && (
            <button type="button" className="btn small secondary" onClick={tap(onLaps)}>
              {rec.laps.length} lap{rec.laps.length === 1 ? '' : 's'}
            </button>
          )}
          {recording ? (
            <button type="button" className="round-btn pause" onClick={() => recorder.pause()} aria-label="Pause">
              <span className="label">
                <Pause fill="currentColor" />
                Pause
              </span>
            </button>
          ) : (
            <button type="button" className="round-btn go" onClick={() => recorder.resume()} aria-label="Resume">
              <span className="label">
                <Play fill="currentColor" />
                Resume
              </span>
            </button>
          )}
        </div>
      )}

      {!idle && recent.length > 0 && (
        <div className="laps-mini">
          {recent.map((l) => {
            const t = l.end - l.start;
            return (
              <div key={l.n} className={`lap-row ${bestLap === t ? 'best' : ''}`}>
                <span className="lap-n">
                  {l.auto ? 'Split' : 'Lap'} {l.n}
                </span>
                <span className="lap-t">{formatDuration(t, 2)}</span>
                <span className="lap-delta">{bestLap != null && t !== bestLap ? <span className="slower">{formatDelta(t - bestLap)}</span> : bestLap === t ? <span className="faster">Best</span> : null}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LapClock({ rec }: { rec: RecorderSnapshot }) {
  const running = rec.state === 'recording';
  const fmt = (now: number) => formatDuration(rec.state === 'idle' ? 0 : recorder.currentLapElapsed(now), 2);
  return (
    <>
      <Ticker running={running} render={(now) => fmt(now).slice(0, -3)} />
      <Ticker running={running} className="frac" render={(now) => fmt(now).slice(-3)} />
    </>
  );
}

function LapsSheet({ rec, onClose }: { rec: RecorderSnapshot; onClose: () => void }) {
  const times = rec.laps.map((l) => l.end - l.start);
  const best = times.length > 1 ? Math.min(...times) : null;
  const worst = times.length > 1 ? Math.max(...times) : null;
  return (
    <Sheet title="Laps" onClose={onClose}>
      <div className="list" style={{ padding: '2px 12px' }}>
        <div className="lap-row current">
          <span className="lap-n">Lap {rec.laps.length + 1}</span>
          <span className="lap-t">
            <Ticker running={rec.state === 'recording'} render={(now) => formatDuration(recorder.currentLapElapsed(now), 2)} />
          </span>
          <span className="lap-delta muted">now</span>
        </div>
        {[...rec.laps].reverse().map((l) => {
          const t = l.end - l.start;
          return (
            <div key={l.n} className={`lap-row ${t === best ? 'best' : t === worst ? 'worst' : ''}`}>
              <span className="lap-n">
                {l.auto ? 'Split' : 'Lap'} {l.n}
              </span>
              <span className="lap-t">{formatDuration(t, 2)}</span>
              <span className="lap-delta">{best != null && t !== best ? <span className="slower">{formatDelta(t - best)}</span> : t === best ? <span className="faster">Best</span> : null}</span>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

