import { Award, Clock3, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { distanceUnit, formatClock, formatDay, formatDistance, formatDistanceValue, formatDuration, formatMonth } from '../lib/format';
import { computeRouteStats } from '../lib/routes';
import type { Trip } from '../lib/types';
import { navigate } from '../hooks/router';
import { dataStore, useData } from '../store/data';
import { useSettings } from '../store/settings';
import { TrackThumb } from '../components/charts';
import { toast } from '../components/Toast';
import { Empty, Page, Row, Section, Stat, tap } from '../components/ui';

export function HistoryView({ routeId }: { routeId?: string }) {
  const { trips, routes } = useData();
  const { units } = useSettings();
  const filtered = useMemo(() => (routeId === 'none' ? trips.filter((t) => !t.routeId) : routeId ? trips.filter((t) => t.routeId === routeId) : trips), [trips, routeId]);
  const bests = useMemo(() => new Set(routes.map((r) => computeRouteStats(r, trips).best?.id).filter(Boolean) as string[]), [routes, trips]);

  const groups = useMemo(() => {
    const m = new Map<string, Trip[]>();
    for (const t of filtered) {
      const k = formatMonth(t.startedAt);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return [...m.entries()];
  }, [filtered]);

  const totals = useMemo(() => {
    const monthAgo = Date.now() - 30 * 86400000;
    const recent = filtered.filter((t) => t.startedAt >= monthAgo);
    return {
      count: recent.length,
      distance: recent.reduce((a, t) => a + t.distance, 0),
      time: recent.reduce((a, t) => a + t.duration, 0),
    };
  }, [filtered]);

  const setFilter = (id?: string) => navigate(id ? `/history?route=${encodeURIComponent(id)}` : '/history', { replace: true });

  return (
    <Page title="History">
      {trips.length === 0 ? (
        <Empty
          icon={Clock3}
          title="No drives yet"
          action={
            <div style={{ display: 'grid', gap: 10, justifyItems: 'center' }}>
              <button type="button" className="btn primary" onClick={tap(() => navigate('/', { tab: true }))}>
                Start a drive
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={tap(async () => {
                  await dataStore.loadSample();
                  toast('Sample commute loaded');
                })}
              >
                <Sparkles /> Explore sample data
              </button>
            </div>
          }
        >
          Hit record on the Drive tab when you set off. Every drive you finish shows up here with its laps, speeds and map.
        </Empty>
      ) : (
        <>
          {routes.length > 0 && (
            <div className="chips" role="tablist" aria-label="Filter by route">
              <button type="button" className={`chip ${!routeId ? 'on' : ''}`} onClick={tap(() => setFilter())}>
                All
              </button>
              {routes.map((r) => (
                <button key={r.id} type="button" className={`chip ${routeId === r.id ? 'on' : ''}`} onClick={tap(() => setFilter(r.id))}>
                  <span className="dot" style={{ background: r.color }} />
                  {r.name}
                </button>
              ))}
              <button type="button" className={`chip ${routeId === 'none' ? 'on' : ''}`} onClick={tap(() => setFilter('none'))}>
                No route
              </button>
            </div>
          )}

          <Section caption="Last 30 days">
            <div className="card">
              <div className="stat-grid three">
                <Stat label="Drives" value={totals.count} />
                <Stat label="Distance" value={formatDistanceValue(totals.distance, units)} unit={distanceUnit(units)} />
                <Stat label="Time" value={formatDuration(totals.time, 0).replace(/^(\d+):(\d{2}):\d{2}$/, '$1h $2m')} />
              </div>
            </div>
          </Section>

          {groups.map(([month, list]) => (
            <Section key={month} caption={month}>
              <div className="list">
                {list.map((t) => {
                  const route = dataStore.route(t.routeId);
                  return (
                    <Row
                      key={t.id}
                      leading={<TrackThumb preview={t.preview} color={route?.color} />}
                      inset={74}
                      title={
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {t.title || route?.name || 'Drive'}
                          {bests.has(t.id) && (
                            <span className="badge gold" style={{ height: 20 }}>
                              <Award strokeWidth={2.6} />
                              PB
                            </span>
                          )}
                        </span>
                      }
                      sub={`${formatDay(t.startedAt)}, ${formatClock(t.startedAt)} · ${formatDistance(t.distance, units)}`}
                      value={<span className="num" style={{ color: 'var(--label)', fontWeight: 600 }}>{formatDuration(t.duration, 0)}</span>}
                      chevron
                      onClick={() => navigate(`/trip/${t.id}`)}
                    />
                  );
                })}
              </div>
            </Section>
          ))}
          {!filtered.length && <Empty icon={Clock3} title="Nothing here" />}
        </>
      )}
    </Page>
  );
}
