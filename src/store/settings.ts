import { useSyncExternalStore } from 'react';
import type { SpeedPalette } from '../lib/color';
import { defaultUnits, speedFromDisplay } from '../lib/format';
import type { Units } from '../lib/types';

export interface Settings {
  units: Units;
  /** Speed (m/s) at which the track turns fully green. */
  speedScaleMax: number;
  speedPalette: SpeedPalette;
  /** Who to race against when a route is selected. */
  compareTo: 'best' | 'median' | 'last';
  /** Lap automatically when passing a route checkpoint. */
  autoLap: boolean;
  /** Finish automatically on arrival at the route's finish. */
  autoFinish: boolean;
  /** Spoken lap and split announcements. */
  voice: boolean;
  keepAwake: boolean;
  appearance: 'auto' | 'light' | 'dark';
  /** Map rotates with your heading while following. */
  headingUp: boolean;
  /** Replace GPS with a simulated drive (demo). */
  simulate: boolean;
  /** Time-lapse factor for Simulation mode. */
  simulateRate: number;
  hapticFeedback: boolean;
  onboarded: boolean;
}

const KEY = 'fury.settings.v1';

function defaults(): Settings {
  const units = defaultUnits();
  return {
    units,
    speedScaleMax: units === 'imperial' ? speedFromDisplay(70, 'imperial') : speedFromDisplay(110, 'metric'),
    speedPalette: 'traffic',
    compareTo: 'best',
    autoLap: true,
    autoFinish: false,
    voice: false,
    keepAwake: true,
    appearance: 'auto',
    headingUp: true,
    simulate: false,
    simulateRate: 8,
    hapticFeedback: true,
    onboarded: false,
  };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return defaults();
}

let current: Settings = load();
const listeners = new Set<() => void>();

export const settingsStore = {
  get(): Settings {
    return current;
  },
  set(patch: Partial<Settings>): void {
    current = { ...current, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      /* storage unavailable */
    }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  replace(s: Partial<Settings>): void {
    settingsStore.set({ ...defaults(), ...s });
  },
};

export function useSettings(): Settings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
}
