import { ChevronLeft, ChevronRight, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { formatDelta } from '../lib/format';
import { haptic } from '../lib/device';
import { settingsStore } from '../store/settings';

export function tap(fn?: () => void) {
  return () => {
    if (settingsStore.get().hapticFeedback) haptic();
    fn?.();
  };
}

export function GlassButton({
  icon: Icon,
  label,
  onClick,
  className = '',
  ariaLabel,
  disabled,
  style,
}: {
  icon?: LucideIcon;
  label?: ReactNode;
  onClick?: () => void;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      className={`glass glass-btn ${label ? 'capsule' : 'icon-btn'} ${className}`}
      onClick={onClick}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      disabled={disabled}
      style={style}
    >
      {Icon && <Icon strokeWidth={2.2} />}
      {label}
    </button>
  );
}

/** Scrollable page with a floating glass nav bar and an iOS large title. */
export function Page({
  title,
  subtitle,
  back,
  actions,
  children,
  animate = 'fade',
  pageKey,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: { onClick: () => void; label?: string };
  actions?: ReactNode;
  children: ReactNode;
  animate?: 'push' | 'fade' | 'none';
  pageKey?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 28);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [pageKey]);
  return (
    <>
      <div className={`navbar ${scrolled ? 'scrolled' : ''}`}>
        <div className="navbar-fade" />
        {back ? <GlassButton icon={ChevronLeft} onClick={tap(back.onClick)} ariaLabel={back.label ?? 'Back'} /> : <div className="navbar-spacer" />}
        <div className="navbar-title">{title}</div>
        <div className="navbar-actions">{actions}</div>
      </div>
      <div ref={ref} className={`page ${animate !== 'none' ? `enter-${animate}` : ''}`} key={pageKey}>
        <h1 className="large-title">{title}</h1>
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
        {children}
      </div>
    </>
  );
}

export function Section({
  title,
  action,
  footer,
  caption,
  children,
  style,
}: {
  title?: ReactNode;
  action?: { label: string; onClick: () => void };
  footer?: ReactNode;
  caption?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section className="section" style={style}>
      {(title || action) && (
        <div className="section-header">
          {title && <h2>{title}</h2>}
          {action && (
            <button type="button" className="action" onClick={tap(action.onClick)}>
              {action.label}
            </button>
          )}
        </div>
      )}
      {caption && <div className="section-caption">{caption}</div>}
      {children}
      {footer && <div className="section-footer">{footer}</div>}
    </section>
  );
}

export function Row({
  icon: Icon,
  iconBg,
  leading,
  title,
  sub,
  value,
  chevron,
  onClick,
  accessory,
  className = '',
  inset,
}: {
  icon?: LucideIcon;
  iconBg?: string;
  leading?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  chevron?: boolean;
  onClick?: () => void;
  accessory?: ReactNode;
  className?: string;
  inset?: number;
}) {
  const body = (
    <>
      {Icon && (
        <span className="row-icon" style={{ background: iconBg ?? 'var(--blue)' }}>
          <Icon strokeWidth={2.2} />
        </span>
      )}
      {leading}
      <span className="row-body">
        <div className="row-title">{title}</div>
        {sub && <div className="row-sub">{sub}</div>}
      </span>
      {value != null && <span className="row-value">{value}</span>}
      {accessory}
      {chevron && <ChevronRight className="row-chevron" strokeWidth={2.6} />}
    </>
  );
  const style = { '--inset': `${inset ?? (Icon ? 58 : 16)}px` } as CSSProperties;
  return onClick ? (
    <button type="button" className={`row ${className}`} onClick={tap(onClick)} style={style}>
      {body}
    </button>
  ) : (
    <div className={`row ${className}`} style={style}>
      {body}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="switch">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(e) => {
          if (settingsStore.get().hapticFeedback) haptic();
          onChange(e.target.checked);
        }}
      />
      <span className="track" />
      <span className="thumb" />
    </span>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  capsule,
  style,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  capsule?: boolean;
  style?: CSSProperties;
}) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const w = 100 / options.length;
  return (
    <div className={`segmented ${capsule ? 'capsule-seg' : ''}`} role="tablist" style={style}>
      <div className="seg-thumb" style={{ left: `calc(${i * w}% + 2px)`, width: `calc(${w}% - 4px)` }} />
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={tap(() => onChange(o.value))}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, unit, sub }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/** Signed time difference; colour is always paired with a sign and an arrow. */
export function Delta({ ms, suffix, precision = 1, icon = true }: { ms: number; suffix?: string; precision?: 0 | 1 | 2; icon?: boolean }) {
  const faster = ms < 0;
  const Icon = faster ? TrendingDown : TrendingUp;
  return (
    <span className={faster ? 'faster' : ms > 0 ? 'slower' : 'muted'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {icon && Math.abs(ms) >= 50 && <Icon size={15} strokeWidth={2.6} />}
      <span className="num">{formatDelta(ms, precision)}</span>
      {suffix && <span style={{ fontWeight: 500 }}>{suffix}</span>}
    </span>
  );
}

export function Empty({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon strokeWidth={2} />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Medal({ rank }: { rank: number }) {
  return <span className={`medal ${rank <= 3 ? `m${rank}` : 'mx'}`}>{rank}</span>;
}
