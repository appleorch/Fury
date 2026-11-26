import { Check, MapPin, Plus, Route as RouteIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatDistance, formatDuration } from '../lib/format';
import { computeRouteStats, routesNear } from '../lib/routes';
import type { LatLon } from '../lib/types';
import { useData } from '../store/data';
import { useSettings } from '../store/settings';
import { PromptSheet, Sheet } from './Sheet';
import { Row } from './ui';

/** Choose the route you're driving (or start a new one) from the Drive screen. */
export function RoutePickerSheet({
  position,
  selectedId,
  pendingName,
  onSelect,
  onNew,
  onClose,
}: {
  position: LatLon | null;
  selectedId: string | null;
  pendingName: string | null;
  onSelect: (id: string | null) => void;
  onNew: (name: string) => void;
  onClose: () => void;
}) {
  const { routes, trips } = useData();
  const { units } = useSettings();
  const [naming, setNaming] = useState(false);
  const items = useMemo(
    () =>
      routesNear(position, routes).map(({ route, dist }) => {
        const st = computeRouteStats(route, trips);
        return { route, dist, count: st.count, best: st.best?.duration ?? null };
      }),
    [position, routes, trips],
  );
  const check = <Check size={20} strokeWidth={2.8} color="var(--blue)" />;
  return (
    <>
      <Sheet title="Which route?" onClose={onClose}>
        <div className="list" style={{ marginBottom: 14 }}>
          <Row
            icon={MapPin}
            iconBg="var(--label-2)"
            title="Free drive"
            sub="Just time it. If it starts and ends where a saved route does, it's matched automatically."
            accessory={!selectedId && !pendingName ? check : undefined}
            onClick={() => {
              onSelect(null);
              onClose();
            }}
          />
        </div>
        {items.length > 0 && (
          <>
            <div className="section-caption">Saved routes{position ? ' · nearest first' : ''}</div>
            <div className="list" style={{ marginBottom: 14 }}>
              {items.map(({ route, dist, count, best }) => {
                const near = dist != null && dist <= route.radius;
                return (
                  <Row
                    key={route.id}
                    leading={<span className="dot" style={{ background: route.color, width: 12, height: 12 }} />}
                    inset={40}
                    title={
                      <>
                        {route.name} {near && <span className="badge blue" style={{ marginLeft: 6 }}>You're here</span>}
                      </>
                    }
                    sub={[
                      dist != null && !near ? `${formatDistance(dist, units)} away` : null,
                      `${count} drive${count === 1 ? '' : 's'}`,
                      best != null ? `best ${formatDuration(best, 0)}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    accessory={selectedId === route.id ? check : undefined}
                    onClick={() => {
                      onSelect(route.id);
                      onClose();
                    }}
                  />
                );
              })}
            </div>
          </>
        )}
        <div className="list">
          <Row
            icon={pendingName ? RouteIcon : Plus}
            iconBg="var(--green)"
            title={pendingName ? `New route: ${pendingName}` : 'New route…'}
            sub="Name it now; it's saved from this drive's start and finish when you're done."
            accessory={pendingName ? check : undefined}
            onClick={() => setNaming(true)}
          />
        </div>
      </Sheet>
      {naming && (
        <PromptSheet
          title="New route"
          message="Give this route a name, like “Home → Work”."
          placeholder="Home → Work"
          initial={pendingName ?? ''}
          confirmLabel="Use this route"
          onSubmit={(name) => {
            onNew(name);
            onClose();
          }}
          onClose={() => setNaming(false)}
        />
      )}
    </>
  );
}
