import { ChevronRight, Plus, Route as RouteIcon, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatDay, formatDistance, formatDuration, formatDurationWords } from '../lib/format';
import { computeRouteStats } from '../lib/routes';
import { navigate } from '../hooks/router';
import { dataStore, useData } from '../store/data';
import { useSettings } from '../store/settings';
import { Sparkline, TrackThumb } from '../components/charts';
import { RoutePlannerSheet } from '../components/RoutePlanner';
import { recorder } from '../store/recorder';
import { toast } from '../components/Toast';
import { Empty, GlassButton, Page, tap } from '../components/ui';
import { useDarkMode } from '../hooks/useTheme';

export function RoutesView() {
  const { routes, trips } = useData();
  const { units } = useSettings();
  const [howTo, setHowTo] = useState(false);
  const dark = useDarkMode();
  const cards = useMemo(
    () =>
      routes
        .map((route) => ({ route, stats: computeRouteStats(route, trips) }))
        .sort((a, b) => (b.stats.last?.startedAt ?? b.route.createdAt) - (a.stats.last?.startedAt ?? a.route.createdAt)),
    [routes, trips],
  );

  return (
    <Page title="Routes" actions={<GlassButton icon={Plus} onClick={tap(() => setHowTo(true))} ariaLabel="New route" />}>
      {!cards.length ? (
        <Empty
          icon={RouteIcon}
          title="No routes yet"
          action={
            <div style={{ display: 'grid', gap: 10, justifyItems: 'center' }}>
              <button type="button" className="btn primary" onClick={tap(() => setHowTo(true))}>
                <Plus /> Create a route
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
          A route is a drive you repeat, like Home → Work. Enter the addresses, or save any finished drive as a route. Fury groups
          drives with the same start and finish so you can see your best, your average, and how today compares.
        </Empty>
      ) : (
        cards.map(({ route, stats }) => {
          const recent = stats.runs.slice(-12).map((r) => r.duration);
          return (
            <button key={route.id} type="button" className="card route-card" onClick={tap(() => navigate(`/routes/${route.id}`))}>
              <div className="route-card-top">
                <TrackThumb preview={stats.best?.preview ?? route.plan?.path ?? []} color={route.color} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="route-card-name">{route.name}</div>
                  <div style={{ fontSize: 13.5, color: 'var(--label-2)' }}>
                    {stats.count} drive{stats.count === 1 ? '' : 's'}
                    {!stats.count && route.plan ? ` · planned ${formatDurationWords(route.plan.duration)}, ${formatDistance(route.plan.distance, units)}` : ''}
                    {stats.count ? ` · ${formatDistance(stats.meanDistance, units)}` : ''}
                    {stats.last ? ` · last ${formatDay(stats.last.startedAt).toLowerCase()}` : ''}
                    {route.sample ? ' · sample' : ''}
                  </div>
                </div>
                <ChevronRight className="row-chevron" strokeWidth={2.6} />
              </div>
              {stats.count > 0 && (
                <div className="route-card-figs">
                  <div>
                    <div className="k">Best</div>
                    <div className="v">{formatDuration(stats.best!.duration, 0)}</div>
                  </div>
                  <div>
                    <div className="k">Average</div>
                    <div className="v">{formatDuration(stats.mean, 0)}</div>
                  </div>
                  <div>
                    <div className="k">Last</div>
                    <div className="v">{formatDuration(stats.last!.duration, 0)}</div>
                  </div>
                </div>
              )}
              {recent.length > 2 && <Sparkline values={recent} color={route.color} />}
            </button>
          );
        })
      )}

      {howTo && <RoutePlannerSheet position={recorder.getSnapshot().fix} dark={dark} onSaved={(r) => navigate(`/routes/${r.id}`)} onClose={() => setHowTo(false)} />}
    </Page>
  );
}
