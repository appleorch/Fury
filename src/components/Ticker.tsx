import { useEffect, useRef } from 'react';
import { clock } from '../lib/clock';

/**
 * Renders frequently-changing text (running stopwatch) by writing to the DOM on animation frames,
 * without re-rendering React. `render` receives the app clock's now.
 */
export function Ticker({ render, running, className, fps = 30 }: { render: (now: number) => string; running: boolean; className?: string; fps?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const renderRef = useRef(render);
  renderRef.current = render;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = renderRef.current(clock.now());
    if (!running) return;
    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      if (t - last >= 1000 / fps) {
        last = t;
        const txt = renderRef.current(clock.now());
        if (el.textContent !== txt) el.textContent = txt;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  });
  return <span ref={ref} className={className} />;
}
