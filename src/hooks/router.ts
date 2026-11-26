import { useSyncExternalStore } from 'react';

export type AppRoute =
  | { name: 'drive' }
  | { name: 'routes' }
  | { name: 'route'; id: string }
  | { name: 'history'; routeId?: string }
  | { name: 'trip'; id: string; fresh: boolean }
  | { name: 'settings' };

export type Tab = 'drive' | 'routes' | 'history' | 'settings';

function parse(hash: string): AppRoute {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const q = new URLSearchParams(query);
  switch (parts[0]) {
    case 'routes':
      return parts[1] ? { name: 'route', id: decodeURIComponent(parts[1]) } : { name: 'routes' };
    case 'history':
      return { name: 'history', routeId: q.get('route') ?? undefined };
    case 'trip':
      return parts[1] ? { name: 'trip', id: decodeURIComponent(parts[1]), fresh: q.get('new') === '1' } : { name: 'history' };
    case 'settings':
      return { name: 'settings' };
    default:
      return { name: 'drive' };
  }
}

export function tabOf(r: AppRoute): Tab {
  switch (r.name) {
    case 'routes':
    case 'route':
      return 'routes';
    case 'history':
    case 'trip':
      return 'history';
    case 'settings':
      return 'settings';
    default:
      return 'drive';
  }
}

interface RouterState {
  route: AppRoute;
  /** 'push' when navigating forward, 'pop' when going back, 'tab' for tab switches. */
  direction: 'push' | 'pop' | 'tab' | 'none';
  key: number;
}

let idx: number = (typeof history !== 'undefined' && history.state?.idx) || 0;
let state: RouterState = { route: parse(typeof location !== 'undefined' ? location.hash : ''), direction: 'none', key: 0 };
const listeners = new Set<() => void>();

function emit(direction: RouterState['direction']) {
  state = { route: parse(location.hash), direction, key: state.key + 1 };
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e) => {
    const next = (e.state?.idx as number | undefined) ?? 0;
    const dir = next < idx ? 'pop' : 'push';
    idx = next;
    emit(dir);
  });
}

export function navigate(path: string, opts: { replace?: boolean; tab?: boolean } = {}): void {
  if (`#${path}` === location.hash) return;
  if (opts.replace) history.replaceState({ idx }, '', `#${path}`);
  else {
    idx++;
    history.pushState({ idx }, '', `#${path}`);
  }
  emit(opts.tab ? 'tab' : 'push');
}

export function goBack(fallback: string): void {
  if (idx > 0) history.back();
  else navigate(fallback, { replace: true });
}

export function useRouter(): RouterState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
