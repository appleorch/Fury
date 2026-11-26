import { Award, Download, Pencil, Plus, Route as RouteIcon, Signpost, Trash2, Trophy, Unlink } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { download } from '../lib/device';
import {
  distanceUnit,
  formatClock,
  formatDay,
  formatDistance,
  formatDistanceValue,
  formatDuration,
  formatDurationWords,
  formatSpeed,
  ordinal,
  speedUnit,
  speedValue,
} from '../lib/format';
import { haversine } from '../lib/geo';
import { toGpx } from '../lib/gpx';
import { computeRouteStats, isLoop, matchRoutes, rankOf, sectorDurations, similarUnassigned, checkpointsKey } from '../lib/routes';
import { computeLapStats, speedHistogram, speedProfile, summarizeLaps } from '../lib/stats';
import type { TrackPoint, Trip } from '../lib/types';
import { goBack, navigate } from '../hooks/router';
import { dataStore, useData } from '../store/data';
import { useSettings } from '../store/settings';
import { ColumnChart, SpeedChart, StripPlot } from '../components/charts';
import { ConfirmSheet, PromptSheet, Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { TripMap } from '../components/TripMap';
import { Delta, Empty, GlassButton, Page, Row, Section, Stat, tap } from '../components/ui';

export function TripView({ id, fresh, dark }: { id: string; fresh: boolean; dark: boolean }) {
  const { trips, routes, ready } = useData();
  const settings = useSettings();
  const { units } = settings;
  const trip = trips.find((t) => t.id === id);
  const route = routes.find((r) => r.id === trip?.routeId);
  const [points, setPoints] = useState<TrackPoint[] | null>(null);
  const [sheet, setSheet] = useState<null | 'rename' | 'delete' | 'saveRoute' | 'assign'>(null);

  useEffect(() => {
    let live = true;
    setPoints(null);
    void dataStore.getTrack(id).then((p) => live && setPoints(p));
    return () => {
      live = false;
    };
  }, [id]);

  const laps = useMemo(() => (trip && points ? computeLapStats(trip.laps, points) : []), [trip, points]);
  const lapSum = useMemo(() => summarizeLaps(laps), [laps]);
  const profile = useMemo(() => (points ? speedProfile(points, 220) : []), [points]);
  const bandWidth = units === 'imperial' ? 10 : 20;
  const hist = useMemo(() => (points ? speedHistogram(points, bandWidth, (v) => speedValue(v, units)) : []), [points, units, bandWidth]);
  const stats = useMemo(() => (route ? computeRouteStats(route, trips) : null), [route, trips]);
  const similar = useMemo(() => (trip && !route ? similarUnassigned(trip, trips) : []), [trip, route, trips]);
  const matches = useMemo(() => (trip ? matchRoutes(trip.start, trip.end, routes) : []), [trip, routes]);

  if (!ready) return null;
  if (!trip) {
    return (
      <Page title="Drive" back={{ onClick: () => goBack('/history') }}>
        <Empty icon={Signpost} title="Drive not found">
          It may have been deleted.
        </Empty>
      </Page>
    );
  }

  const intended = !route && trip.intendedRouteId ? routes.find((r) => r.id === trip.intendedRouteId) : undefined;
  const title = trip.title || route?.name || (isLoop(trip) ? 'Loop' : 'Drive');
  const rank = stats ? rankOf(trip, stats) : 0;
  const isPB = !!stats && stats.count > 1 && rank === 1;
  const prevBest = stats && stats.count > 1 ? (isPB ? stats.ranked[1] : stats.ranked[0]) : null;
  const vsBest = prevBest ? trip.duration - prevBest.duration : null;
  const vsAvg = stats && stats.count > 1 ? trip.duration - stats.mean : null;
  const time = formatDuration(trip.duration, 2);
  const [main, frac] = [time.slice(0, -3), time.slice(-3)];
  const key = route ? checkpointsKey(route.checkpoints) : '';
  const mySectors = route && trip.sectors?.key === key ? sectorDurations(trip.sectors.times, trip.duration) : null;

  const exportGpx = () => {
    if (!points) return;
    const name = `${title} ${new Date(trip.startedAt).toISOString().slice(0, 10)}`;
    download(new Blob([toGpx(trip, points, name)], { type: 'application/gpx+xml' }), `${name.replace(/[^\w-]+/g, '_')}.gpx`);
  };

  return (
    <Page
      title={title}
      pageKey={id}
      animate="push"
      back={{ onClick: () => goBack('/history') }}
      subtitle={`${formatDay(trip.startedAt)} · ${formatClock(trip.startedAt)} – ${formatClock(trip.endedAt)}${trip.sample ? ' · Sample' : trip.simulated ? ' · Simulated' : ''}`}
      actions={<GlassButton icon={Pencil} onClick={tap(() => setSheet('rename'))} ariaLabel="Rename" />}
    >
      {fresh && isPB && (
        <div className="celebrate">
          <Trophy />
          <div>
            <b>New personal best!</b>
            <span>
              {prevBest ? `${formatDuration(-vsBest!, 1)} faster than your previous best on ${route!.name}.` : `Fastest of your ${stats!.count} drives.`}
            </span>
          </div>
        </div>
      )}

      {intended && (
        <div className="card card-pad" style={{ marginBottom: 18, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Signpost size={22} style={{ color: 'var(--orange)', flex: 'none', marginTop: 2 }} />
          <div style={{ flex: 1, fontSize: 15, lineHeight: 1.4 }}>
            <b>Not counted for {intended.name}.</b>{' '}
            <span className="muted">
              {trip.start && haversine(trip.start, intended.start) > intended.radius
                ? "It didn't start near the route's start"
                : trip.end && haversine(trip.end, intended.end) > intended.radius
                  ? "It didn't finish near the route's finish"
                  : 'Its length is very different from your usual drive on this route'}
              , so it's kept out of the route's records.
            </span>
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn small secondary"
                onClick={tap(async () => {
                  await dataStore.assignRoute(trip.id, intended.id);
                  toast(`Counted for ${intended.name}`);
                })}
              >
                Count it anyway
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="hero">
        <div className="hero-kicker">{fresh ? 'Drive complete' : 'Total time'}</div>
        <div className="hero-time">
          {main}
          <span className="frac">{frac}</span>
        </div>
        <div className="hero-badges">
          {stats && stats.count > 1 && (
            <span className={`badge ${rank === 1 ? 'gold' : 'blue'}`}>
              {rank === 1 ? <Award strokeWidth={2.6} /> : null}
              {rank === 1 ? 'Personal best' : rank === stats.count ? `Slowest of ${stats.count}` : `${ordinal(rank)} fastest of ${stats.count}`}
            </span>
          )}
          {route && (
            <button type="button" className="badge" onClick={tap(() => navigate(`/routes/${route.id}`))}>
              <span className="dot" style={{ background: route.color, width: 8, height: 8 }} /> {route.name}
            </button>
          )}
          <span className="badge">
            {formatDistance(trip.distance, units)} · {laps.length} lap{laps.length === 1 ? '' : 's'}
          </span>
        </div>
        {(vsBest != null || vsAvg != null) && (
          <div className="compare-lines">
            {vsBest != null && !isPB && <Delta ms={vsBest} suffix=" vs your best" />}
            {vsBest != null && isPB && <Delta ms={vsBest} suffix=" vs previous best" />}
            {vsAvg != null && <Delta ms={vsAvg} suffix=" vs your average" />}
          </div>
        )}
      </div>

      <Section>
        {points ? (
          <TripMap points={points} laps={trip.laps} dark={dark} checkpoints={route?.checkpoints} />
        ) : (
          <div className="map-card" />
        )}
      </Section>

      <Section>
        <div className="card">
          <div className="stat-grid">
            <Stat label="Distance" value={formatDistanceValue(trip.distance, units)} unit={distanceUnit(units)} />
            <Stat label="Average speed" value={formatSpeed(trip.stats.avgSpeed, units)} unit={speedUnit(units)} />
            <Stat label="Top speed" value={formatSpeed(trip.stats.maxSpeed, units)} unit={speedUnit(units)} />
            <Stat label="Moving average" value={formatSpeed(trip.stats.movingAvgSpeed, units)} unit={speedUnit(units)} />
            <Stat label="Moving time" value={formatDuration(trip.stats.movingTime, 0)} />
            <Stat
              label="Stopped"
              value={formatDuration(trip.stats.stoppedTime, 0)}
              sub={`${trip.stats.stops} stop${trip.stats.stops === 1 ? '' : 's'}${trip.duration ? ` · ${Math.round((trip.stats.stoppedTime / trip.duration) * 100)}% of drive` : ''}`}
            />
            {trip.stats.elevationGain != null && (
              <Stat
                label="Climb"
                value={units === 'imperial' ? Math.round(trip.stats.elevationGain * 3.28084) : Math.round(trip.stats.elevationGain)}
                unit={units === 'imperial' ? 'ft' : 'm'}
              />
            )}
            {trip.pauses.length > 0 && (
              <Stat label="Paused" value={formatDurationWords(trip.pauses.reduce((a, p) => a + (p.end - p.start), 0))} sub={`${trip.pauses.length}×`} />
            )}
          </div>
        </div>
      </Section>

      {laps.length > 0 && (
        <Section title={laps.some((l) => l.auto) ? 'Laps & splits' : 'Laps'}>
          <div className="card">
            <LapTable laps={laps} best={lapSum.best} worst={lapSum.worst} />
          </div>
          {lapSum.mean != null && (
            <div className="section-footer">
              Average lap {formatDuration(lapSum.mean, 1)} · spread {formatDuration(laps[lapSum.worst!].duration - laps[lapSum.best!].duration, 1)}
            </div>
          )}
        </Section>
      )}

      {stats && stats.count > 1 && (
        <Section title="How this drive stacks up" action={{ label: 'Route stats', onClick: () => navigate(`/routes/${route!.id}`) }}>
          <div className="card">
            <div className="chart-sub" style={{ paddingTop: 14 }}>
              {stats.count} drives on {route!.name}
            </div>
            <div style={{ padding: '6px 4px 10px' }}>
              <StripPlot values={stats.runs.map((r) => ({ id: r.id, v: r.duration }))} highlightId={trip.id} />
            </div>
            <div className="stat-grid three" style={{ borderTop: '0.5px solid var(--separator)' }}>
              <Stat label="Rank" value={`${rank}`} unit={`of ${stats.count}`} />
              <Stat label="Best" value={formatDuration(stats.best!.duration, 0)} />
              <Stat label="Average" value={formatDuration(stats.mean, 0)} />
            </div>
            {mySectors && stats.sectors.length > 0 && (
              <table className="lap-table" style={{ borderTop: '0.5px solid var(--separator)' }}>
                <thead>
                  <tr>
                    <th>Sector</th>
                    <th>This</th>
                    <th>Best</th>
                    <th>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.sectors.map((s, i) => {
                    const mine = mySectors[i];
                    return (
                      <tr key={i}>
                        <td className="wrap">{sectorName(route!, i)}</td>
                        <td>{mine != null ? formatDuration(mine, 1) : '–'}</td>
                        <td className="muted">{s.best != null ? formatDuration(s.best, 1) : '–'}</td>
                        <td>{mine != null && s.best != null ? mine - s.best < 50 ? <span className="faster">Best</span> : <Delta ms={mine - s.best} icon={false} /> : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Section>
      )}

      {profile.length > 2 && (
        <Section title="Speed">
          <div className="card">
            <div className="chart-sub" style={{ paddingTop: 12 }}>
              Speed along the drive, coloured like the map line
            </div>
            <div className="chart-body">
              <SpeedChart samples={profile} units={units} speedMax={settings.speedScaleMax} palette={settings.speedPalette} />
            </div>
          </div>
        </Section>
      )}

      {hist.length > 0 && (
        <Section title="Time at speed">
          <div className="card">
            <div className="chart-body">
              <ColumnChart
                data={hist.map((b) => ({
                  key: String(b.from),
                  label: `${b.from}`,
                  value: b.time,
                  display: formatDurationWords(b.time).replace(' min', 'm').replace(' s', 's'),
                  detail: `${b.from}–${b.to} ${speedUnit(units)} · ${Math.round((b.time / trip.duration) * 100)}%`,
                }))}
              />
            </div>
          </div>
          <div className="section-footer">Each column is {bandWidth} {speedUnit(units)} wide, starting at the number shown.</div>
        </Section>
      )}

      <Section title="Route">
        <div className="list">
          {route ? (
            <>
              <Row
                leading={<span className="dot" style={{ background: route.color, width: 12, height: 12 }} />}
                inset={40}
                title={route.name}
                sub="See all drives and trends on this route"
                chevron
                onClick={() => navigate(`/routes/${route.id}`)}
              />
              <Row icon={Unlink} iconBg="var(--label-2)" title="Change route" onClick={() => setSheet('assign')} chevron />
            </>
          ) : (
            <>
              <Row
                icon={Plus}
                iconBg="var(--green)"
                title="Save as a route"
                sub={
                  similar.length
                    ? `You've driven this ${similar.length + 1} times. Group them to compare.`
                    : 'Future drives with the same start and finish are matched automatically.'
                }
                onClick={() => setSheet('saveRoute')}
                chevron
              />
              {routes.length > 0 && (
                <Row
                  icon={RouteIcon}
                  iconBg="var(--blue)"
                  title="Add to existing route"
                  sub={matches.length ? `Matches ${matches[0].route.name}` : undefined}
                  onClick={() => setSheet('assign')}
                  chevron
                />
              )}
            </>
          )}
        </div>
      </Section>

      <Section>
        <div className="list">
          <Row icon={Download} iconBg="var(--indigo)" title="Export GPX" sub="Open in other mapping apps" onClick={exportGpx} />
          <Row icon={Trash2} iconBg="var(--red)" title="Delete drive" className="destructive" onClick={() => setSheet('delete')} />
        </div>
      </Section>

      {sheet === 'rename' && (
        <PromptSheet
          title="Rename drive"
          initial={trip.title ?? ''}
          placeholder={route?.name ?? 'Drive'}
          onSubmit={(v) => dataStore.updateTrip({ ...trip, title: v })}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'delete' && (
        <ConfirmSheet
          title="Delete this drive?"
          message="Its track, laps and statistics will be removed from this iPhone. Route records update automatically."
          confirmLabel="Delete drive"
          destructive
          onConfirm={async () => {
            await dataStore.deleteTrip(trip.id);
            toast('Drive deleted');
            goBack('/history');
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'saveRoute' && (
        <PromptSheet
          title="Save as route"
          message={
            <>
              Name the route from here to there.
              {trip.laps.length > 1 ? ' Your lap points become checkpoints, so every future drive gets comparable splits.' : ''}
              {similar.length ? ` ${similar.length} earlier drive${similar.length === 1 ? '' : 's'} with the same start and finish will be added.` : ''}
            </>
          }
          placeholder="Home → Work"
          confirmLabel="Save route"
          onSubmit={async (name) => {
            const r = await dataStore.createRouteFromTrip(trip, name, similar);
            toast(`Saved “${r.name}”`);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'assign' && <AssignSheet trip={trip} onClose={() => setSheet(null)} />}
    </Page>
  );
}

export function sectorName(route: { checkpoints: { name?: string }[] }, i: number): string {
  const n = route.checkpoints.length;
  if (i === 0) return `Start → ${route.checkpoints[0]?.name ?? 'CP 1'}`;
  if (i === n) return `${route.checkpoints[n - 1]?.name ?? `CP ${n}`} → Finish`;
  return `${route.checkpoints[i - 1].name ?? `CP ${i}`} → ${route.checkpoints[i].name ?? `CP ${i + 1}`}`;
}

function LapTable({ laps, best, worst }: { laps: ReturnType<typeof computeLapStats>; best: number | null; worst: number | null }) {
  const { units } = useSettings();
  const maxDur = Math.max(...laps.map((l) => l.duration));
  return (
    <table className="lap-table">
      <thead>
        <tr>
          <th>Lap</th>
          <th>Time</th>
          <th>Dist</th>
          <th>Avg</th>
        </tr>
      </thead>
      <tbody>
        {laps.map((l, i) => (
          <tr key={l.n} className={i === best ? 'best' : i === worst ? 'worst' : ''}>
            <td>
              {l.n}
              {i === best && <span className="lap-tag faster">Best</span>}
              {i === worst && <span className="lap-tag slower">Slowest</span>}
              {l.auto && i !== best && i !== worst && <span className="lap-tag muted">Auto</span>}
            </td>
            <td style={{ width: '38%' }}>
              {formatDuration(l.duration, 2)}
              <div className="lap-bar" style={{ width: `${(l.duration / maxDur) * 100}%`, marginLeft: 'auto' }} />
            </td>
            <td className="muted">{formatDistance(l.distance, units)}</td>
            <td className="muted">{formatSpeed(l.avgSpeed, units)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AssignSheet({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const { routes } = useData();
  const matched = new Set(matchRoutes(trip.start, trip.end, routes).map((m) => m.route.id));
  const sorted = [...routes].sort((a, b) => Number(matched.has(b.id)) - Number(matched.has(a.id)));
  return (
    <Sheet title="Choose route" onClose={onClose}>
      <div className="list">
        {sorted.map((r) => (
          <Row
            key={r.id}
            leading={<span className="dot" style={{ background: r.color, width: 12, height: 12 }} />}
            inset={40}
            title={r.name}
            sub={matched.has(r.id) ? 'Same start and finish' : 'Different start or finish'}
            accessory={trip.routeId === r.id ? <span className="badge blue">Current</span> : undefined}
            onClick={async () => {
              await dataStore.assignRoute(trip.id, r.id);
              toast(`Added to ${r.name}`);
              onClose();
            }}
          />
        ))}
        {trip.routeId && (
          <Row
            icon={Unlink}
            iconBg="var(--label-2)"
            title="No route"
            className="destructive"
            onClick={async () => {
              await dataStore.assignRoute(trip.id, null);
              onClose();
            }}
          />
        )}
      </div>
    </Sheet>
  );
}
