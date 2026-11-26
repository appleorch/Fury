import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { speedColor, type SpeedPalette } from '../lib/color';
import { distanceUnit, distanceValue, formatDuration, formatShortDate, speedUnit, speedValue } from '../lib/format';
import { formatMinuteOfDay } from '../lib/routes';
import type { SpeedSample } from '../lib/stats';
import type { Units } from '../lib/types';

/* Shared chart plumbing ------------------------------------------------------ */

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** "Nice" tick values for an axis. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Ticks for durations in ms, on whole 30 s / minute / 5 minute steps. */
function durationTicks(min: number, max: number, count = 4): number[] {
  const span = max - min;
  const steps = [5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000];
  const step = steps.find((s) => span / s <= count) ?? 3600000;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}

interface Tip {
  x: number;
  content: ReactNode;
}

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const x = Math.max(56, Math.min(width - 56, tip.x));
  return (
    <div className="chart-tip glass strong" style={{ left: x }}>
      {tip.content}
    </div>
  );
}

function pointerX(e: React.PointerEvent, el: SVGSVGElement): number {
  return e.clientX - el.getBoundingClientRect().left;
}

/* Speed over distance ---------------------------------------------------------- */

export function SpeedChart({
  samples,
  units,
  speedMax,
  palette,
  height = 170,
}: {
  samples: SpeedSample[];
  units: Units;
  speedMax: number;
  palette: SpeedPalette;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<(Tip & { i: number }) | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pad = { l: 34, r: 8, t: 40, b: 22 };
  const data = useMemo(() => samples.map((s) => ({ x: distanceValue(s.d, units), y: speedValue(s.v, units), e: s.e, v: s.v })), [samples, units]);
  if (!data.length) return <div ref={ref} className="chart" style={{ height }} />;
  const xMax = data[data.length - 1].x || 1;
  const yMaxRaw = Math.max(...data.map((d) => d.y), 10);
  const yTicks = niceTicks(0, yMaxRaw * 1.05, 3);
  const yMax = Math.max(yTicks[yTicks.length - 1], yMaxRaw);
  const iw = Math.max(1, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const sx = (x: number) => pad.l + (x / xMax) * iw;
  const sy = (y: number) => pad.t + ih - (y / yMax) * ih;
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${sx(d.x).toFixed(1)},${sy(d.y).toFixed(1)}`).join('');
  const area = `${path}L${sx(xMax)},${sy(0)}L${sx(0)},${sy(0)}Z`;
  const stride = Math.max(1, Math.floor(data.length / 60));
  const stops = data.filter((_, i) => i % stride === 0 || i === data.length - 1);
  const gid = `spd-${palette}`;
  const xTicks = niceTicks(0, xMax, Math.max(2, Math.floor(iw / 70)));

  const onMove = (e: React.PointerEvent) => {
    if (!svgRef.current) return;
    const px = pointerX(e, svgRef.current);
    const x = ((px - pad.l) / iw) * xMax;
    let best = 0;
    for (let i = 1; i < data.length; i++) if (Math.abs(data[i].x - x) < Math.abs(data[best].x - x)) best = i;
    const d = data[best];
    setTip({
      i: best,
      x: sx(d.x),
      content: (
        <>
          <div className="v">
            {d.y.toFixed(0)} {speedUnit(units)}
          </div>
          <div className="l">
            {d.x.toFixed(xMax < 10 ? 2 : 1)} {distanceUnit(units)} · {formatDuration(d.e, 0)}
          </div>
        </>
      ),
    });
  };

  return (
    <div ref={ref} className="chart" style={{ height }}>
      {width > 0 && (
        <svg ref={svgRef} width={width} height={height} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setTip(null)}>
          <defs>
            <linearGradient id={gid} x1={sx(0)} x2={sx(xMax)} y1="0" y2="0" gradientUnits="userSpaceOnUse">
              {stops.map((d, i) => (
                <stop key={i} offset={`${(d.x / xMax) * 100}%`} stopColor={speedColor(d.v / speedMax, palette)} />
              ))}
            </linearGradient>
          </defs>
          {yTicks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={pad.l} x2={width - pad.r} y1={sy(t)} y2={sy(t)} />
              <text className="axis-text" x={pad.l - 6} y={sy(t) + 4} textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} className="axis-text" x={sx(t)} y={height - 5} textAnchor="middle">
              {t}
            </text>
          ))}
          <text className="axis-text" x={width - pad.r} y={height - 5} textAnchor="end">
            {distanceUnit(units)}
          </text>
          <path d={area} fill={`url(#${gid})`} opacity={0.14} />
          <path d={path} fill="none" stroke={`url(#${gid})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {tip && (
            <>
              <line className="crosshair" x1={tip.x} x2={tip.x} y1={pad.t - 4} y2={sy(0)} />
              <circle cx={tip.x} cy={sy(data[tip.i].y)} r={5} fill={speedColor(data[tip.i].v / speedMax, palette)} stroke="var(--chart-surface)" strokeWidth={2} />
            </>
          )}
        </svg>
      )}
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

/* Vertical columns --------------------------------------------------------------- */

export interface ColumnDatum {
  key: string;
  label: string;
  value: number;
  display: string;
  detail?: string;
  muted?: boolean;
}

export function ColumnChart({ data, height = 170, color = 'var(--blue)', baselineZero = true }: { data: ColumnDatum[]; height?: number; color?: string; baselineZero?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<(Tip & { k: string }) | null>(null);
  const pad = { l: 6, r: 6, t: 40, b: 24 };
  const vals = data.map((d) => d.value).filter((v) => Number.isFinite(v));
  const max = vals.length ? Math.max(...vals) : 1;
  const min = baselineZero ? 0 : Math.min(...vals) * 0.9;
  const iw = Math.max(1, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const slot = iw / Math.max(1, data.length);
  const bw = Math.min(24, slot * 0.62);
  const sy = (v: number) => pad.t + ih - ((v - min) / (max - min || 1)) * ih;
  return (
    <div ref={ref} className="chart" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} onPointerLeave={() => setTip(null)}>
          <line className="grid-line" x1={pad.l} x2={width - pad.r} y1={sy(min)} y2={sy(min)} />
          {data.map((d, i) => {
            const cx = pad.l + slot * i + slot / 2;
            const ok = Number.isFinite(d.value) && d.value > min;
            const y = ok ? sy(d.value) : sy(min);
            const h = sy(min) - y;
            const r = Math.min(4, h);
            const active = tip?.k === d.key;
            const show = () =>
              setTip({
                k: d.key,
                x: cx,
                content: (
                  <>
                    <div className="v">{d.display}</div>
                    <div className="l">{d.detail ?? d.label}</div>
                  </>
                ),
              });
            return (
              <g key={d.key} onPointerEnter={show} onPointerDown={show}>
                <rect x={cx - slot / 2} y={pad.t - 20} width={slot} height={ih + 20 + pad.b} fill="transparent" />
                {ok && (
                  <path
                    d={`M${cx - bw / 2},${sy(min)}V${y + r}Q${cx - bw / 2},${y} ${cx - bw / 2 + r},${y}H${cx + bw / 2 - r}Q${cx + bw / 2},${y} ${cx + bw / 2},${y + r}V${sy(min)}Z`}
                    fill={d.muted ? 'var(--label-3)' : color}
                    opacity={tip && !active ? 0.55 : 1}
                  />
                )}
                {ok && data.length <= 8 && (
                  <text className="axis-text" x={cx} y={y - 6} textAnchor="middle" style={{ fill: 'var(--label)', fontWeight: 600 }}>
                    {d.display}
                  </text>
                )}
                <text className="axis-text" x={cx} y={height - 6} textAnchor="middle">
                  {d.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

/* Runs over time / departure scatter ---------------------------------------------- */

export interface RunDot {
  id: string;
  x: number;
  y: number;
  label?: string;
}

/**
 * Dot plot of run durations against date (or departure time). Optional rolling-average line,
 * one highlighted run, nearest-point hover.
 */
export function RunsChart({
  dots,
  highlightId,
  bestId,
  mode,
  height = 200,
  trend = true,
  onSelect,
}: {
  dots: RunDot[];
  highlightId?: string | null;
  bestId?: string | null;
  mode: 'date' | 'time';
  height?: number;
  trend?: boolean;
  onSelect?: (id: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [tip, setTip] = useState<(Tip & { id: string }) | null>(null);
  const pad = { l: 46, r: 12, t: 44, b: 24 };
  if (!dots.length) return <div ref={ref} className="chart" style={{ height }} />;
  const xs = dots.map((d) => d.x);
  const ys = dots.map((d) => d.y);
  let xMin = Math.min(...xs);
  let xMax = Math.max(...xs);
  if (xMax === xMin) {
    xMin -= mode === 'date' ? 86400000 : 30;
    xMax += mode === 'date' ? 86400000 : 30;
  }
  const yLo = Math.min(...ys);
  const yHi = Math.max(...ys);
  const ySpan = Math.max(yHi - yLo, 60000);
  const yMin = yLo - ySpan * 0.15;
  const yMax = yHi + ySpan * 0.15;
  const iw = Math.max(1, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const sx = (x: number) => pad.l + ((x - xMin) / (xMax - xMin)) * iw;
  const sy = (y: number) => pad.t + ih - ((y - yMin) / (yMax - yMin)) * ih;
  const yTicks = durationTicks(yMin, yMax, 4);
  const xTicks =
    mode === 'date'
      ? niceDateTicks(xMin, xMax, Math.max(2, Math.floor(iw / 80)))
      : niceTicks(xMin, xMax, Math.max(2, Math.floor(iw / 80))).map((m) => Math.round(m / 15) * 15);
  const sorted = [...dots].sort((a, b) => a.x - b.x);
  const k = Math.min(5, Math.max(2, Math.floor(sorted.length / 4)));
  const rolling =
    trend && mode === 'date' && sorted.length >= 4
      ? sorted.map((d, i) => {
          const win = sorted.slice(Math.max(0, i - k + 1), i + 1);
          return { x: d.x, y: win.reduce((a, b) => a + b.y, 0) / win.length };
        })
      : [];
  const anyHighlight = !!highlightId && dots.some((d) => d.id === highlightId);

  const onMove = (e: React.PointerEvent) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    let best: RunDot | null = null;
    let bd = Infinity;
    for (const d of dots) {
      const dist = Math.hypot(sx(d.x) - px, (sy(d.y) - py) * 0.6);
      if (dist < bd) {
        bd = dist;
        best = d;
      }
    }
    if (!best || bd > 60) return setTip(null);
    setTip({
      id: best.id,
      x: sx(best.x),
      content: (
        <>
          <div className="v">{formatDuration(best.y, 1)}</div>
          <div className="l">{best.label ?? (mode === 'date' ? formatShortDate(best.x) : formatMinuteOfDay(best.x))}</div>
        </>
      ),
    });
  };

  return (
    <div ref={ref} className="chart" style={{ height }}>
      {width > 0 && (
        <svg
          ref={svgRef}
          width={width}
          height={height}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setTip(null)}
          onClick={() => tip && onSelect?.(tip.id)}
          style={{ cursor: onSelect ? 'pointer' : undefined }}
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={pad.l} x2={width - pad.r} y1={sy(t)} y2={sy(t)} />
              <text className="axis-text" x={pad.l - 6} y={sy(t) + 4} textAnchor="end">
                {formatDuration(t, 0)}
              </text>
            </g>
          ))}
          {xTicks
            .filter((t) => t >= xMin && t <= xMax)
            .map((t) => (
              <text key={t} className="axis-text" x={sx(t)} y={height - 6} textAnchor="middle">
                {mode === 'date' ? formatShortDate(t) : formatMinuteOfDay(t)}
              </text>
            ))}
          {rolling.length > 1 && (
            <path
              d={rolling.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('')}
              fill="none"
              stroke="var(--label-3)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {dots.map((d) => {
            const hl = d.id === highlightId;
            const isBest = d.id === bestId;
            const fill = anyHighlight ? (hl ? 'var(--blue)' : 'var(--label-3)') : isBest ? 'var(--gold)' : 'var(--blue)';
            return (
              <circle
                key={d.id}
                cx={sx(d.x)}
                cy={sy(d.y)}
                r={hl ? 7 : tip?.id === d.id ? 6 : 4.5}
                fill={fill}
                stroke="var(--chart-surface)"
                strokeWidth={2}
              />
            );
          })}
          {bestId &&
            dots
              .filter((d) => d.id === bestId)
              .map((d) => (
                <text key="best" className="axis-text" x={sx(d.x)} y={sy(d.y) - 11} textAnchor="middle" style={{ fill: 'var(--label)', fontWeight: 600 }}>
                  Best
                </text>
              ))}
          {anyHighlight &&
            dots
              .filter((d) => d.id === highlightId)
              .map((d) => (
                <text key="hl" className="axis-text" x={sx(d.x)} y={sy(d.y) - 13} textAnchor="middle" style={{ fill: 'var(--label)', fontWeight: 700 }}>
                  This drive
                </text>
              ))}
        </svg>
      )}
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

function niceDateTicks(min: number, max: number, count: number): number[] {
  const day = 86400000;
  const spanDays = (max - min) / day;
  const step = [1, 2, 7, 14, 30, 61, 91, 182, 365].find((s) => spanDays / s <= count) ?? 365;
  const out: number[] = [];
  const start = new Date(min);
  start.setHours(0, 0, 0, 0);
  if (step >= 7 && step < 30) start.setDate(start.getDate() + ((8 - start.getDay()) % 7)); // Mondays
  if (step >= 30) start.setDate(1);
  for (let t = start.getTime(); t <= max; ) {
    if (t >= min) out.push(t);
    const d = new Date(t);
    if (step >= 30) d.setMonth(d.getMonth() + Math.round(step / 30));
    else d.setDate(d.getDate() + step);
    t = d.getTime();
  }
  return out;
}

/* Strip plot: where this run sits among all runs ------------------------------------ */

export function StripPlot({ values, highlightId, height = 86 }: { values: { id: string; v: number }[]; highlightId: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const pad = { l: 14, r: 14 };
  if (!values.length) return <div ref={ref} style={{ height }} />;
  const vs = values.map((x) => x.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const span = Math.max(hi - lo, 30000);
  const min = lo - span * 0.06;
  const max = hi + span * 0.06;
  const iw = Math.max(1, width - pad.l - pad.r);
  const sx = (v: number) => pad.l + ((v - min) / (max - min)) * iw;
  const mid = 34;
  const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
  const me = values.find((x) => x.id === highlightId);
  return (
    <div ref={ref} className="chart" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height}>
          <line className="grid-line" x1={pad.l} x2={width - pad.r} y1={mid} y2={mid} />
          <line x1={sx(mean)} x2={sx(mean)} y1={mid - 14} y2={mid + 14} stroke="var(--label-2)" strokeWidth={1} />
          <text className="axis-text" x={sx(mean)} y={mid + 28} textAnchor="middle">
            Avg {formatDuration(mean, 0)}
          </text>
          {values
            .filter((x) => x.id !== highlightId)
            .map((x) => (
              <circle key={x.id} cx={sx(x.v)} cy={mid} r={4.5} fill="var(--label-3)" stroke="var(--chart-surface)" strokeWidth={2} />
            ))}
          {me && (
            <>
              <circle cx={sx(me.v)} cy={mid} r={8} fill="var(--blue)" stroke="var(--chart-surface)" strokeWidth={2} />
              <text className="axis-text" x={sx(me.v)} y={mid - 16} textAnchor="middle" style={{ fill: 'var(--label)', fontWeight: 700 }}>
                This drive
              </text>
            </>
          )}
          <text className="axis-text" x={pad.l} y={height - 4} textAnchor="start">
            Faster · {formatDuration(lo, 0)}
          </text>
          <text className="axis-text" x={width - pad.r} y={height - 4} textAnchor="end">
            {formatDuration(hi, 0)} · Slower
          </text>
        </svg>
      )}
    </div>
  );
}

/* Sparkline --------------------------------------------------------------------------- */

export function Sparkline({ values, height = 34, color = 'var(--blue)' }: { values: number[]; height?: number; color?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  if (values.length < 2) return <div ref={ref} style={{ height }} />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pad = 5;
  const sx = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  // Same orientation as the drives chart: lower = faster.
  const sy = (v: number) => height - pad - ((v - lo) / span) * (height - pad * 2);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('');
  const last = values.length - 1;
  return (
    <div ref={ref} className="spark" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} aria-hidden="true">
          <path d={d} fill="none" stroke="var(--label-3)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={sx(last)} cy={sy(values[last])} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
        </svg>
      )}
    </div>
  );
}

/* Route thumbnail ----------------------------------------------------------------------- */

export function TrackThumb({ preview, color = 'var(--blue)', size = 46 }: { preview: [number, number][]; color?: string; size?: number }) {
  if (preview.length < 2) return <div className="thumb" style={{ width: size, height: size }} />;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [la, lo] of preview) {
    minLat = Math.min(minLat, la);
    maxLat = Math.max(maxLat, la);
    minLon = Math.min(minLon, lo);
    maxLon = Math.max(maxLon, lo);
  }
  const k = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const w = (maxLon - minLon) * k || 1e-6;
  const h = maxLat - minLat || 1e-6;
  const s = (size - 12) / Math.max(w, h);
  const ox = (size - w * s) / 2;
  const oy = (size - h * s) / 2;
  const d = preview.map(([la, lo], i) => `${i ? 'L' : 'M'}${(ox + (lo - minLon) * k * s).toFixed(1)},${(oy + (maxLat - la) * s).toFixed(1)}`).join('');
  return (
    <div className="thumb" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <path d={d} fill="none" stroke={color} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}
