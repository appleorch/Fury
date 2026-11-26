import {
  Activity,
  AudioLines,
  Download,
  Eye,
  Flag,
  Gauge,
  HardDrive,
  Info,
  Map as MapIcon,
  MonitorSmartphone,
  Play,
  Smartphone,
  Sparkles,
  Sun,
  Timer,
  Trash2,
  Upload,
  Vibrate,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { speedGradientCss } from '../lib/color';
import { isStandalone, shareOrDownload, wakeLockSupported } from '../lib/device';
import { speedFromDisplay, speedUnit, speedValue } from '../lib/format';
import { dataStore, useData } from '../store/data';
import { recorder, useRecorder } from '../store/recorder';
import { settingsStore, useSettings } from '../store/settings';
import { ConfirmSheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { Page, Row, Section, Segmented, Switch } from '../components/ui';

export function SettingsView() {
  const s = useSettings();
  const set = settingsStore.set;
  const { trips, routes } = useData();
  const rec = useRecorder();
  const [usage, setUsage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'clear' | 'sample'>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hasSample = routes.some((r) => r.sample) || trips.some((t) => t.sample);
  const busy = rec.state !== 'idle';

  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => {
      if (e.usage != null) setUsage(`${(e.usage / 1024 / 1024).toFixed(1)} MB used`);
    });
  }, [trips.length]);

  const scaleMin = s.units === 'imperial' ? 30 : 50;
  const scaleMax = s.units === 'imperial' ? 100 : 160;
  const scaleVal = Math.round(speedValue(s.speedScaleMax, s.units) / 5) * 5;

  return (
    <Page title="Settings">
      <Section caption="Units & display">
        <div className="list">
          <Row
            icon={Gauge}
            iconBg="var(--blue)"
            title="Units"
            accessory={
              <Segmented
                value={s.units}
                onChange={(units) => {
                  const display = Math.round(speedValue(s.speedScaleMax, s.units));
                  const conv = units === 'imperial' ? Math.round(display / 1.609 / 5) * 5 : Math.round((display * 1.609) / 10) * 10;
                  set({ units, speedScaleMax: speedFromDisplay(conv, units) });
                }}
                options={[
                  { value: 'imperial', label: 'mph' },
                  { value: 'metric', label: 'km/h' },
                ]}
                style={{ width: 140 }}
              />
            }
          />
          <Row
            icon={Sun}
            iconBg="var(--indigo)"
            title="Theme"
            accessory={
              <Segmented
                value={s.appearance}
                onChange={(appearance) => set({ appearance })}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
                style={{ width: 180 }}
              />
            }
          />
        </div>
      </Section>

      <Section caption="Speed colours" footer="The line on the map shifts from red when you're slow (corners, lights) to green at this speed and above.">
        <div className="list">
          <div className="slider-row">
            <div className="slider-head">
              <span>Fully green at</span>
              <b className="num">
                {scaleVal} {speedUnit(s.units)}
              </b>
            </div>
            <div className="speed-legend" style={{ marginBottom: 10 }}>
              <span className="bar" style={{ background: speedGradientCss(s.speedPalette), height: 8, borderRadius: 4 }} />
            </div>
            <input
              type="range"
              min={scaleMin}
              max={scaleMax}
              step={5}
              value={scaleVal}
              aria-label="Speed for full green"
              style={{ '--fill-pct': `${((scaleVal - scaleMin) / (scaleMax - scaleMin)) * 100}%` } as React.CSSProperties}
              onChange={(e) => set({ speedScaleMax: speedFromDisplay(Number(e.target.value), s.units) })}
            />
          </div>
          <Row
            icon={Eye}
            iconBg="var(--teal)"
            title="Colour-blind friendly"
            sub="Purple → yellow instead of red → green"
            accessory={<Switch label="Colour-blind friendly" checked={s.speedPalette === 'vision'} onChange={(v) => set({ speedPalette: v ? 'vision' : 'traffic' })} />}
          />
        </div>
      </Section>

      <Section caption="While driving">
        <div className="list">
          <Row
            icon={MonitorSmartphone}
            iconBg="var(--green)"
            title="Keep screen on"
            sub={wakeLockSupported() ? 'iPhone pauses GPS for web apps when locked' : 'Not supported here: set Auto-Lock to Never'}
            accessory={<Switch label="Keep screen on" checked={s.keepAwake} onChange={(keepAwake) => set({ keepAwake })} />}
          />
          <Row icon={Vibrate} iconBg="var(--pink)" title="Haptics" accessory={<Switch label="Haptics" checked={s.hapticFeedback} onChange={(hapticFeedback) => set({ hapticFeedback })} />} />
          <Row
            icon={AudioLines}
            iconBg="var(--purple)"
            title="Spoken laps"
            sub="Announces lap times and gaps"
            accessory={<Switch label="Spoken laps" checked={s.voice} onChange={(voice) => set({ voice })} />}
          />
          <Row
            icon={MapIcon}
            iconBg="var(--blue)"
            title="Map follows heading"
            accessory={<Switch label="Map follows heading" checked={s.headingUp} onChange={(headingUp) => set({ headingUp })} />}
          />
        </div>
      </Section>

      <Section caption="Routes">
        <div className="list">
          <Row
            icon={Activity}
            iconBg="var(--orange)"
            title="Race against"
            accessory={
              <Segmented
                value={s.compareTo}
                onChange={(compareTo) => set({ compareTo })}
                options={[
                  { value: 'best', label: 'Best' },
                  { value: 'median', label: 'Typical' },
                  { value: 'last', label: 'Last' },
                ]}
                style={{ width: 190 }}
              />
            }
          />
          <Row
            icon={Timer}
            iconBg="var(--indigo)"
            title="Auto-lap at checkpoints"
            accessory={<Switch label="Auto-lap at checkpoints" checked={s.autoLap} onChange={(autoLap) => set({ autoLap })} />}
          />
          <Row
            icon={Flag}
            iconBg="var(--red)"
            title="Auto-finish on arrival"
            sub="Stops the timer when you reach the route's finish"
            accessory={<Switch label="Auto-finish on arrival" checked={s.autoFinish} onChange={(autoFinish) => set({ autoFinish })} />}
          />
        </div>
      </Section>

      <Section caption="Try it out" footer="Simulation drives a demo commute in San Jose as a time-lapse, so you can try the timer, laps and stats from your couch.">
        <div className="list">
          <Row
            icon={Play}
            iconBg="var(--orange)"
            title="Simulation mode"
            sub={busy ? 'Finish the current drive to change' : 'Replaces GPS with a demo drive'}
            accessory={<Switch label="Simulation mode" checked={s.simulate} onChange={(simulate) => !busy && set({ simulate })} />}
          />
          {s.simulate && (
            <Row
              title="Time-lapse speed"
              accessory={
                <Segmented
                  value={s.simulateRate}
                  onChange={(simulateRate) => !busy && set({ simulateRate })}
                  options={[1, 4, 8, 16].map((v) => ({ value: v, label: `${v}×` }))}
                  style={{ width: 190 }}
                />
              }
            />
          )}
          <Row
            icon={Sparkles}
            iconBg="var(--yellow)"
            title={hasSample ? 'Remove sample history' : 'Load sample history'}
            sub={hasSample ? 'Deletes only the sample route and drives' : 'A month of commutes to explore the statistics'}
            className={hasSample ? 'destructive' : 'tinted'}
            onClick={async () => {
              if (hasSample) {
                await dataStore.removeSample();
                await recorder.setRoute(null);
                toast('Sample data removed');
              } else {
                await dataStore.loadSample();
                toast('Sample commute loaded');
              }
            }}
          />
        </div>
      </Section>

      <Section caption="Your data" footer="Everything stays on this iPhone. There's no account and nothing is uploaded. Export a backup now and then; deleting the app from your Home Screen deletes its data.">
        <div className="list">
          <Row
            icon={Download}
            iconBg="var(--blue)"
            title="Export backup"
            sub={`${trips.filter((t) => !t.sample).length} drives · ${routes.filter((r) => !r.sample).length} routes`}
            onClick={async () => {
              const blob = await dataStore.exportAll();
              await shareOrDownload(blob, `fury-backup-${new Date().toISOString().slice(0, 10)}.json`);
            }}
          />
          <Row icon={Upload} iconBg="var(--green)" title="Import backup" onClick={() => fileRef.current?.click()} />
          <Row icon={HardDrive} iconBg="var(--label-2)" title="Storage" value={usage ?? '–'} />
          <Row icon={Trash2} iconBg="var(--red)" title="Delete all data" className="destructive" onClick={() => setConfirm('clear')} />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const r = await dataStore.importAll(await f.text());
              toast(`Imported ${r.trips} drives, ${r.routes} routes`);
            } catch (err) {
              toast((err as Error).message || 'Import failed', 'warn');
            }
          }}
        />
      </Section>

      <Section caption="About">
        <div className="list">
          <Row
            icon={Smartphone}
            iconBg="var(--label-2)"
            title={isStandalone() ? 'Installed on Home Screen' : 'Install on iPhone'}
            sub={isStandalone() ? 'Running as an app' : 'Safari → Share → Add to Home Screen'}
          />
          <Row icon={Info} iconBg="var(--blue)" title="Fury" value={`v${__APP_VERSION__}`} />
        </div>
        <div className="section-footer">
          Maps © OpenStreetMap contributors, tiles by OpenFreeMap. GPS accuracy depends on your phone and sky view.
          Keep your eyes on the road: set things up before you drive.
        </div>
      </Section>

      {confirm === 'clear' && (
        <ConfirmSheet
          title="Delete all data?"
          message="All drives, routes and the current recording will be permanently deleted from this iPhone."
          confirmLabel="Delete everything"
          destructive
          onConfirm={async () => {
            await recorder.discard();
            await recorder.setRoute(null);
            await dataStore.clearAll();
            toast('All data deleted');
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </Page>
  );
}
