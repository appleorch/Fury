import { useEffect, useSyncExternalStore } from 'react';
import { useSettings } from '../store/settings';

const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function subscribe(l: () => void) {
  mq?.addEventListener('change', l);
  return () => mq?.removeEventListener('change', l);
}

/** Effective dark mode (System / Light / Dark setting), applied to <html data-theme>. */
export function useDarkMode(): boolean {
  const { appearance } = useSettings();
  const systemDark = useSyncExternalStore(subscribe, () => !!mq?.matches);
  const dark = appearance === 'dark' || (appearance === 'auto' && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#000000' : '#f2f2f7'));
  }, [dark]);
  return dark;
}
