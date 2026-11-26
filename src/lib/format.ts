import type { Units } from './types';

const MINUS = '−';

function pad(n: number, w = 2): string {
  return String(Math.floor(n)).padStart(w, '0');
}

/**
 * Stopwatch formatting.
 *  precision 2 → 1:23.45   precision 1 → 1:23.4   precision 0 → 1:23
 * Hours appear only when needed: 1:02:03.45
 */
export function formatDuration(ms: number, precision: 0 | 1 | 2 = 2): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const unit = precision === 2 ? 10 : precision === 1 ? 100 : 1000;
  const total = Math.floor(ms / unit) * unit;
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const frac = total % 1000;
  let out = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  if (precision === 2) out += `.${pad(frac / 10)}`;
  else if (precision === 1) out += `.${Math.floor(frac / 100)}`;
  return out;
}

/** Split a stopwatch string so the fractional part can be styled separately. */
export function splitDuration(ms: number, precision: 1 | 2 = 2): { main: string; frac: string } {
  const s = formatDuration(ms, precision);
  const i = s.lastIndexOf('.');
  return { main: s.slice(0, i), frac: s.slice(i) };
}

/** Human friendly long duration: "23 min", "1 h 04 min", "48 s". */
export function formatDurationWords(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}

/** Signed delta, e.g. "−0:12.3" / "+4.2". Short form omits minutes under a minute. */
export function formatDelta(ms: number, precision: 0 | 1 | 2 = 1): string {
  const sign = ms < 0 ? MINUS : '+';
  const abs = Math.abs(ms);
  if (abs < 60000) {
    const unit = precision === 2 ? 100 : precision === 1 ? 10 : 1;
    const v = Math.floor((abs / 1000) * unit) / unit;
    return `${sign}${v.toFixed(precision)}`;
  }
  return `${sign}${formatDuration(abs, precision)}`;
}

export const MPS_TO_KMH = 3.6;
export const MPS_TO_MPH = 2.2369362920544;

export function speedValue(mps: number, units: Units): number {
  return mps * (units === 'imperial' ? MPS_TO_MPH : MPS_TO_KMH);
}

export function speedFromDisplay(v: number, units: Units): number {
  return v / (units === 'imperial' ? MPS_TO_MPH : MPS_TO_KMH);
}

export function speedUnit(units: Units): string {
  return units === 'imperial' ? 'mph' : 'km/h';
}

export function formatSpeed(mps: number, units: Units, digits = 0): string {
  return speedValue(Math.max(0, mps), units).toFixed(digits);
}

export function distanceValue(m: number, units: Units): number {
  return units === 'imperial' ? m / 1609.344 : m / 1000;
}

export function distanceUnit(units: Units): string {
  return units === 'imperial' ? 'mi' : 'km';
}

/** "12.4" (value only) for the big unit, with sensible precision. */
export function formatDistanceValue(m: number, units: Units): string {
  const v = distanceValue(m, units);
  if (v < 10) return v.toFixed(2);
  if (v < 100) return v.toFixed(1);
  return Math.round(v).toLocaleString();
}

export function formatDistance(m: number, units: Units): string {
  if (units === 'metric' && m < 1000) return `${Math.round(m)} m`;
  if (units === 'imperial' && m < 160.9) return `${Math.round(m * 3.28084)} ft`;
  return `${formatDistanceValue(m, units)} ${distanceUnit(units)}`;
}

export function formatClock(epoch: number): string {
  return new Date(epoch).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function startOfDay(epoch: number): number {
  const d = new Date(epoch);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function formatDay(epoch: number, now = Date.now()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(epoch)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const d = new Date(epoch);
  if (diff > 1 && diff < 7) return d.toLocaleDateString([], { weekday: 'long' });
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

export function formatShortDate(epoch: number): string {
  return new Date(epoch).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatMonth(epoch: number): string {
  return new Date(epoch).toLocaleDateString([], { month: 'long', year: 'numeric' });
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function defaultUnits(): Units {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
  // Countries that sign road speeds in mph
  return /-(US|GB|LR|MM|PR|VI|GU|AS|MP|BS|BZ|KY|FK|AG|DM|GD|KN|LC|VC|WS)\b/i.test(lang) ? 'imperial' : 'metric';
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
