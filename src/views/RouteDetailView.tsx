import { Lightbulb, MapPinned, Pencil, Signpost, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ROUTE_COLORS } from '../lib/color';
import { formatClock, formatDay, formatDistance, formatDuration, formatDurationWords, WEEKDAYS } from '../lib/format';
import { projectOnSegment, simplifyTo } from '../lib/geo';
import { computeRouteStats, departureInsight, formatMinuteOfDay, minutesOfDay } from '../lib/routes';
import type { LatLon, Route, TrackPoint } from '../lib/types';
import { goBack, navigate } from '../hooks/router';
import { dataStore, newId, useData } from '../store/data';
import { useSettings } from '../store/settings';
import { ColumnChart, RunsChart } from '../components/charts';
import { ConfirmSheet, PromptSheet, Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { TripMap } from '../components/TripMap';
import { Delta, Empty, GlassButton, Medal, Page, Row, Section, Segmented, Stat, tap } from '../components/ui';
import { sectorName } from './TripView';

export function RouteDetailView({ id, dark }: { id: string; dark: boolean }) {
  const { routes, trips, ready } = useData();
  const { units } = useSettings();
  const route = routes.find((r) => r.id === id);
  const stats = useMemo(() => (route ? computeRouteStats(route, trips) : null), [route, trips]);
  const [order, setOrder] = useState<'recent' | 'fastest'>('recent');
  const [chartMode, setChartMode] = useState<'date' | 'time'>('date');
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState<null | 'rename' | 'delete' | 'radius'>(null);
  const [refPoints, setRefPoints] = useState<TrackPoint[]>([]);

  const refId = stats?.best?.id;
  useEffect(() => {
    if (!refId) return setRefPoints([]);
    let live = true;
    void dataStore.getTrack(refId).then((p) => live && setRefPoints(p));
    return () => {
      live = false;
    };
  }, [refId]);
  const refPath = useMemo(() => simplifyTo(refPoints, 800), [refPoints]);

  if (!ready) return null;
  if (!route || !stats) {
    return (
      <Page title="Route" back={{ onClick: () => goBack('/routes') }}>
        <Empty icon={Signpost} title="Route not found" />
      </Page>
    );
  }

  const insight = departureInsight(stats);
  const runs = order === 'recent' ? [...stats.runs].reverse() : stats.ranked;
  const weekdays = stats.weekday.filter((w) => w.count > 0 || (w.day >= 1 && w.day <= 5));

  const addCheckpoint = (p: LatLon) => {
    if (refPoints.length < 2) return;
    // Snap to the reference drive so the checkpoint sits on the road.
    let best = { d: Infinity, lat: p.lat, lon: p.lon };
    for (let i = 1; i < refPoints.length; i++) {
      const a = refPoints[i - 1];
      const b = refPoints[i];
      const pr = projectOnSegment(p, a, b);
      if (pr.dist < best.d) best = { d: pr.dist, lat: a.lat + (b.lat - a.lat) * pr.t, lon: a.lon + (b.lon - a.lon) * pr.t };
    }
    if (best.d > 120) return toast('Tap on the route line to add a checkpoint', 'info');
    // Keep checkpoints in driving order.
    const order = (q: LatLon) => {
      let bi = 0;
      let bd = Infinity;
      refPoints.forEach((r, i) => {
        const d = Math.hypot(r.lat - q.lat, r.lon - q.lon);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      return bi;
    };
    const cps = [...route.checkpoints, { id: newId(), lat: best.lat, lon: best.lon }].sort((a, b) => order(a) - order(b));
    void dataStore.saveRoute({ ...route, checkpoints: cps.map((c, i) => ({ ...c, name: c.name && !/^Split \d+$|^CP \d+$/.test(c.name) ? c.name : `CP ${i + 1}` })) });
  };

  return (
    <Page
      title={route.name}
      pageKey={id}
      animate="push"
      back={{ onClick: () => goBack('/routes') }}
      subtitle={`${stats.count} drive${stats.count === 1 ? '' : 's'}${stats.count ? ` · about ${formatDistance(stats.meanDistance, units)}` : ''}${route.sample ? ' · sample data' : ''}`}
      actions={<GlassButton icon={Pencil} onClick={tap(() => setSheet('rename'))} ariaLabel="Rename route" />}
    >
      {stats.count === 0 ? (
        <Empty icon={MapPinned} title="No drives yet">
          Select this route on the Drive screen before you set off, or finish a drive with the same start and finish.
        </Empty>
      ) : (
        <>
          <Section>
            <div className="card">
              <div className="stat-grid three">
                <Stat label="Best" value={formatDuration(stats.best!.duration, 0)} sub={formatDay(stats.best!.startedAt)} />
                <Stat label="Average" value={formatDuration(stats.mean, 0)} sub={`median ${formatDuration(stats.median, 0)}`} />
                <Stat label="Last" value={formatDuration(stats.last!.duration, 0)} sub={formatDay(stats.last!.startedAt)} />
              </div>
              <div className="stat-grid" style={{ borderTop: '0.5px solid var(--separator)' }}>
                <Stat label="Consistency" value={`±${formatDurationWords(stats.stdev)}`} sub="typical variation" />
                <Stat
                  label="Trend"
                  value={
                    stats.trendPerWeek == null ? (
                      '–'
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {stats.trendPerWeek < 0 ? <TrendingDown size={20} className="faster" /> : <TrendingUp size={20} className="slower" />}
                        {formatDurationWords(Math.abs(stats.trendPerWeek))}
                      </span>
                    )
                  }
                  sub={stats.trendPerWeek == null ? 'needs 5+ drives' : stats.trendPerWeek < 0 ? 'faster per week' : 'slower per week'}
                />
              </div>
            </div>
          </Section>

          <Section title="Every drive">
            <div className="card">
              <div style={{ padding: '12px 12px 0' }}>
                <Segmented
                  value={chartMode}
                  onChange={setChartMode}
                  options={[
                    { value: 'date', label: 'By date' },
                    { value: 'time', label: 'By departure time' },
                  ]}
                />
              </div>
              <div className="chart-sub" style={{ paddingTop: 10 }}>
                {chartMode === 'date' ? 'Lower is faster · line shows your rolling average' : 'When you leave vs how long it takes'}
              </div>
              <div className="chart-body">
                <RunsChart
                  mode={chartMode}
                  bestId={stats.best!.id}
                  dots={stats.runs.map((r) => ({
                    id: r.id,
                    x: chartMode === 'date' ? r.startedAt : minutesOfDay(r.startedAt),
                    y: r.duration,
                    label: `${formatDay(r.startedAt)} · left ${formatClock(r.startedAt)}`,
                  }))}
                  onSelect={(tid) => navigate(`/trip/${tid}`)}
                />
              </div>
              {insight && (
                <div className="insight">
                  <Lightbulb />
                  <span>
                    Leaving {formatMinuteOfDay(insight.fast.from)}–{formatMinuteOfDay(insight.fast.to)} averages{' '}
                    <b>{formatDuration(insight.fast.mean, 0)}</b>, about <b>{formatDurationWords(insight.diff)}</b> quicker than leaving{' '}
                    {formatMinuteOfDay(insight.slow.from)}–{formatMinuteOfDay(insight.slow.to)}.
                  </span>
                </div>
              )}
            </div>
          </Section>

          {weekdays.some((w) => w.count > 0) && (
            <Section title="By day of week">
              <div className="card">
                <div className="chart-body">
                  <ColumnChart
                    data={weekdays.map((w) => ({
                      key: String(w.day),
                      label: WEEKDAYS[w.day],
                      value: w.count ? w.mean : NaN,
                      display: w.count ? formatDuration(w.mean, 0) : '–',
                      detail: `${WEEKDAYS[w.day]} · ${w.count} drive${w.count === 1 ? '' : 's'}`,
                    }))}
                    height={160}
                  />
                </div>
              </div>
              <div className="section-footer">Average drive time for each weekday you've driven this route.</div>
            </Section>
          )}

          {route.checkpoints.length > 0 && stats.sectors.some((s) => s.count > 0) && (
            <Section title="Sectors">
              <div className="card">
                <table className="lap-table">
                  <thead>
                    <tr>
                      <th>Sector</th>
                      <th>Best</th>
                      <th>Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.sectors.map((s, i) => (
                      <tr key={i}>
                        <td className="wrap">{sectorName(route, i)}</td>
                        <td>{s.best != null ? formatDuration(s.best, 1) : '–'}</td>
                        <td className="muted">{s.mean != null ? formatDuration(s.mean, 1) : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {stats.theoreticalBest != null && (
                <div className="section-footer">
                  Your best sectors add up to <b>{formatDuration(stats.theoreticalBest, 1)}</b>,{' '}
                  {formatDurationWords(stats.best!.duration - stats.theoreticalBest)} under your best drive. That's your theoretical best.
                </div>
              )}
            </Section>
          )}
        </>
      )}

      <Section
        title="Map & checkpoints"
        action={refPoints.length > 1 ? { label: editing ? 'Done' : 'Edit', onClick: () => setEditing((e) => !e) } : undefined}
        footer={
          editing
            ? 'Tap the route line to add a checkpoint. Tap a purple checkpoint to remove it. Drives are re-split automatically.'
            : 'Checkpoints split every drive into sectors and trigger automatic laps while you drive.'
        }
      >
        <TripMap
          points={refPoints}
          refPath={refPath}
          checkpoints={route.checkpoints}
          dark={dark}
          interactive={editing}
          height={editing ? 380 : 260}
          onMapClick={editing ? addCheckpoint : undefined}
          onCheckpointClick={editing ? (cp) => void dataStore.saveRoute({ ...route, checkpoints: route.checkpoints.filter((c) => c.id !== cp.id) }) : undefined}
        />
      </Section>

      {stats.count > 0 && (
        <Section title="Drives">
          <Segmented
            value={order}
            onChange={setOrder}
            style={{ marginBottom: 10 }}
            options={[
              { value: 'recent', label: 'Recent' },
              { value: 'fastest', label: 'Fastest' },
            ]}
          />
          <div className="list">
            {runs.map((t) => {
              const rank = stats.ranked.indexOf(t) + 1;
              return (
                <Row
                  key={t.id}
                  leading={<Medal rank={rank} />}
                  inset={50}
                  title={
                    <span className="num" style={{ fontWeight: 600 }}>
                      {formatDuration(t.duration, 1)}
                    </span>
                  }
                  sub={`${formatDay(t.startedAt)} · left ${formatClock(t.startedAt)}`}
                  value={rank === 1 ? <span className="badge gold">Best</span> : <Delta ms={t.duration - stats.best!.duration} icon={false} />}
                  chevron
                  onClick={() => navigate(`/trip/${t.id}`)}
                />
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Settings">
        <div className="list">
          <div className="color-swatches" role="radiogroup" aria-label="Route colour">
            {ROUTE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={route.color === c}
                aria-label={`Colour ${c}`}
                className={route.color === c ? 'on' : ''}
                style={{ background: c, color: c }}
                onClick={tap(() => void dataStore.saveRoute({ ...route, color: c }))}
              />
            ))}
          </div>
          <Row title="Start & finish radius" value={formatDistance(route.radius, units)} chevron onClick={() => setSheet('radius')} />
          <Row icon={Trash2} iconBg="var(--red)" title="Delete route" className="destructive" onClick={() => setSheet('delete')} />
        </div>
      </Section>

      {sheet === 'rename' && (
        <PromptSheet title="Rename route" initial={route.name} onSubmit={(name) => dataStore.saveRoute({ ...route, name })} onClose={() => setSheet(null)} />
      )}
      {sheet === 'radius' && <RadiusSheet route={route} onClose={() => setSheet(null)} />}
      {sheet === 'delete' && (
        <DeleteRouteSheet
          route={route}
          count={stats.count}
          onDone={() => {
            setSheet(null);
            goBack('/routes');
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </Page>
  );
}

function RadiusSheet({ route, onClose }: { route: Route; onClose: () => void }) {
  const { units } = useSettings();
  const [r, setR] = useState(route.radius);
  return (
    <Sheet title="Start & finish radius" onClose={onClose}>
      <p style={{ margin: '0 4px 12px', color: 'var(--label-2)', fontSize: 15, lineHeight: 1.4 }}>
        A drive belongs to this route when it starts and finishes within this distance of the route's start and finish.
      </p>
      <div className="list">
        <div className="slider-row">
          <div className="slider-head">
            <span>Radius</span>
            <b className="num">{formatDistance(r, units)}</b>
          </div>
          <input
            type="range"
            min={50}
            max={1000}
            step={25}
            value={r}
            onChange={(e) => setR(Number(e.target.value))}
            aria-label="Radius"
            style={{ '--fill-pct': `${((r - 50) / 950) * 100}%` } as React.CSSProperties}
          />
        </div>
      </div>
      <div className="sheet-actions" style={{ paddingTop: 14 }}>
        <button
          type="button"
          className="btn block primary"
          onClick={tap(async () => {
            await dataStore.saveRoute({ ...route, radius: r });
            onClose();
          })}
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}

function DeleteRouteSheet({ route, count, onDone, onClose }: { route: Route; count: number; onDone: () => void; onClose: () => void }) {
  const [alsoTrips, setAlsoTrips] = useState(false);
  if (!count)
    return (
      <ConfirmSheet
        title={`Delete “${route.name}”?`}
        confirmLabel="Delete route"
        destructive
        onConfirm={async () => {
          await dataStore.deleteRoute(route.id);
          onDone();
        }}
        onClose={onClose}
      />
    );
  return (
    <ConfirmSheet
      title={`Delete “${route.name}”?`}
      message={
        <>
          {count} drive{count === 1 ? ' is' : 's are'} on this route.{' '}
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, color: 'var(--label)' }}>
            <input type="checkbox" checked={alsoTrips} onChange={(e) => setAlsoTrips(e.target.checked)} style={{ width: 20, height: 20 }} />
            Also delete those drives
          </label>
        </>
      }
      confirmLabel={alsoTrips ? 'Delete route and drives' : 'Delete route, keep drives'}
      destructive
      onConfirm={async () => {
        await dataStore.deleteRoute(route.id, alsoTrips);
        onDone();
      }}
      onClose={onClose}
    />
  );
}
