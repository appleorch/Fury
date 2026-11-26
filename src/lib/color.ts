/**
 * Speed → colour scales for the track line. Values are normalised 0..1 (0 = stopped, 1 = scale max).
 * "traffic" is the semantic red → green heat scale the app is built around (slow corners red, fast
 * highway green). "vision" is a colour-vision-deficiency-safe alternative (dark violet → yellow).
 */
export type SpeedPalette = 'traffic' | 'vision';

export const SPEED_STOPS: Record<SpeedPalette, [number, string][]> = {
  traffic: [
    [0, '#ff3b30'],
    [0.3, '#ff7a1a'],
    [0.55, '#ffcc00'],
    [0.78, '#a6e22e'],
    [1, '#30d158'],
  ],
  vision: [
    [0, '#5b2a86'],
    [0.3, '#3b5bdb'],
    [0.55, '#1aa59a'],
    [0.78, '#8cc43f'],
    [1, '#f5d90a'],
  ],
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function speedColor(v: number, palette: SpeedPalette = 'traffic'): string {
  const stops = SPEED_STOPS[palette];
  const x = Math.max(0, Math.min(1, v));
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i];
    if (x <= p1) {
      const [p0, c0] = stops[i - 1];
      const t = (x - p0) / (p1 - p0);
      const a = hexToRgb(c0);
      const b = hexToRgb(c1);
      const m = a.map((av, k) => Math.round(av + (b[k] - av) * t));
      return `rgb(${m[0]}, ${m[1]}, ${m[2]})`;
    }
  }
  return stops[stops.length - 1][1];
}

/** MapLibre interpolate expression over the feature property `v` (0..1). */
export function speedColorExpression(palette: SpeedPalette): unknown[] {
  const expr: unknown[] = ['interpolate', ['linear'], ['get', 'v']];
  for (const [p, c] of SPEED_STOPS[palette]) expr.push(p, c);
  return expr;
}

export function speedGradientCss(palette: SpeedPalette): string {
  return `linear-gradient(90deg, ${SPEED_STOPS[palette].map(([p, c]) => `${c} ${p * 100}%`).join(', ')})`;
}

/** Route accent colours, iOS system palette. */
export const ROUTE_COLORS = ['#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#ff375f', '#64d2ff', '#ffd60a', '#ac8e68'];
