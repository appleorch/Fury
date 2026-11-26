import { Clock3, Gauge, Route as RouteIcon, Settings as SettingsIcon, Sparkles, Timer, MapPinned, LineChart, Share } from 'lucide-react';
import { useEffect } from 'react';
import { navigate, tabOf, useRouter, type Tab } from './hooks/router';
import { useDarkMode } from './hooks/useTheme';
import { isIOS, isStandalone } from './lib/device';
import { dataStore, useData } from './store/data';
import { useRecorder } from './store/recorder';
import { settingsStore, useSettings } from './store/settings';
import { Sheet } from './components/Sheet';
import { ToastHost, toast } from './components/Toast';
import { tap } from './components/ui';
import { LiveView } from './views/LiveView';
import { TripView } from './views/TripView';
import { RoutesView } from './views/RoutesView';
import { RouteDetailView } from './views/RouteDetailView';
import { HistoryView } from './views/HistoryView';
import { SettingsView } from './views/SettingsView';

const TABS: { id: Tab; label: string; icon: typeof Timer; path: string }[] = [
  { id: 'drive', label: 'Drive', icon: Gauge, path: '/' },
  { id: 'routes', label: 'Routes', icon: RouteIcon, path: '/routes' },
  { id: 'history', label: 'History', icon: Clock3, path: '/history' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, path: '/settings' },
];

export function App() {
  const { route, key } = useRouter();
  const dark = useDarkMode();
  const rec = useRecorder();
  const { ready } = useData();
  const settings = useSettings();
  const tab = tabOf(route);
  const hideTabs = tab === 'drive' && rec.state === 'recording';

  useEffect(() => {
    document.title = rec.state === 'recording' ? 'Fury · Recording' : 'Fury';
  }, [rec.state]);

  return (
    <div className="app">
      <div className={`screen ${tab === 'drive' ? '' : 'hidden'}`} aria-hidden={tab !== 'drive'}>
        <LiveView active={tab === 'drive'} dark={dark} />
      </div>
      {tab !== 'drive' && ready && (
        <div className="screen" key={route.name === 'trip' || route.name === 'route' ? key : route.name}>
          {route.name === 'routes' && <RoutesView />}
          {route.name === 'route' && <RouteDetailView id={route.id} dark={dark} />}
          {route.name === 'history' && <HistoryView routeId={route.routeId} />}
          {route.name === 'trip' && <TripView id={route.id} fresh={route.fresh} dark={dark} />}
          {route.name === 'settings' && <SettingsView />}
        </div>
      )}

      <nav className={`tabbar-wrap ${hideTabs ? 'hidden' : ''}`} aria-label="Tabs">
        <div className="tabbar glass">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab ${tab === t.id ? 'active' : ''}`}
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={tap(() => {
                if (tab === t.id && route.name !== t.id) navigate(t.path, { replace: true, tab: true });
                else navigate(t.path, { tab: true });
              })}
            >
              <t.icon strokeWidth={tab === t.id ? 2.4 : 2} />
              {t.label}
              {t.id === 'drive' && rec.state !== 'idle' && tab !== 'drive' && <span className="rec-dot" />}
            </button>
          ))}
        </div>
      </nav>

      {ready && !settings.onboarded && <Onboarding />}
      <ToastHost />
    </div>
  );
}

function Onboarding() {
  const done = () => settingsStore.set({ onboarded: true });
  const ios = isIOS();
  return (
    <Sheet onClose={done}>
      <div className="onboard-hero">
        <img className="app-icon" src="./icons/icon-192.png" alt="" />
        <h2 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>Welcome to Fury</h2>
        <p style={{ margin: '6px 0 0', color: 'var(--label-2)', fontSize: 15 }}>A GPS stopwatch for the drives you repeat.</p>
      </div>
      <div className="feature-list">
        <div className="feature">
          <Timer />
          <div>
            <b>Hit record, tap Lap</b>
            <span>Big lap timer, pause and finish, and a map line that turns red in corners and green on the highway.</span>
          </div>
        </div>
        <div className="feature">
          <MapPinned />
          <div>
            <b>Routes like Home → Work</b>
            <span>Drives with the same start and finish are grouped. Race your best run live, with automatic splits.</span>
          </div>
        </div>
        <div className="feature">
          <LineChart />
          <div>
            <b>Stats across days</b>
            <span>Best, average, trends, the best time to leave, and how today stacks up.</span>
          </div>
        </div>
        {ios && !isStandalone() && (
          <div className="feature">
            <Share />
            <div>
              <b>Add to Home Screen</b>
              <span>In Safari tap Share → Add to Home Screen. It runs full-screen and keeps your data. No account needed.</span>
            </div>
          </div>
        )}
      </div>
      <div className="sheet-actions">
        <button type="button" className="btn block primary" onClick={tap(done)}>
          Get started
        </button>
        <button
          type="button"
          className="btn block secondary"
          onClick={tap(async () => {
            await dataStore.loadSample();
            settingsStore.set({ onboarded: true, simulate: true });
            toast('Sample data and Simulation mode are on', 'info', 3500);
          })}
        >
          <Sparkles /> Explore with a demo drive
        </button>
      </div>
    </Sheet>
  );
}
