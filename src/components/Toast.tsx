import { CheckCircle2, Info, AlertTriangle, type LucideIcon } from 'lucide-react';
import { useSyncExternalStore } from 'react';

interface ToastMsg {
  id: number;
  text: string;
  kind: 'ok' | 'info' | 'warn';
}

let current: ToastMsg | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
let seq = 0;

export function toast(text: string, kind: ToastMsg['kind'] = 'ok', ms = 2600): void {
  current = { id: ++seq, text, kind };
  listeners.forEach((l) => l());
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    current = null;
    listeners.forEach((l) => l());
  }, ms);
}

const ICONS: Record<ToastMsg['kind'], [LucideIcon, string]> = {
  ok: [CheckCircle2, 'var(--green)'],
  info: [Info, 'var(--blue)'],
  warn: [AlertTriangle, 'var(--orange)'],
};

export function ToastHost() {
  const msg = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  if (!msg) return null;
  const [Icon, color] = ICONS[msg.kind];
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      <div className="toast glass strong" key={msg.id}>
        <Icon style={{ color }} strokeWidth={2.4} />
        {msg.text}
      </div>
    </div>
  );
}
