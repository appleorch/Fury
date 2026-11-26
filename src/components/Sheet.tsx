import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GlassButton, tap } from './ui';

/**
 * Bottom sheet on Liquid Glass. Drag the grabber down (or tap outside) to dismiss.
 * Render it conditionally; `onClose` is called after the exit animation.
 */
export function Sheet({ title, onClose, children, footer }: { title?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const [closing, setClosing] = useState(false);
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);
  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 260);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onPointerDown = (e: React.PointerEvent) => {
    startY.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current != null) setDrag(Math.max(0, e.clientY - startY.current));
  };
  const onPointerUp = () => {
    if (drag > 110) close();
    setDrag(0);
    startY.current = null;
  };

  return createPortal(
    <div className={`sheet-root ${closing ? 'closing' : ''}`} role="dialog" aria-modal="true">
      <div className="sheet-backdrop" onClick={close} />
      <div
        className="sheet glass strong"
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
      >
        <div onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} style={{ touchAction: 'none' }}>
          <div className="sheet-grabber" />
          {title && (
            <div className="sheet-head">
              <h3>{title}</h3>
              <GlassButton icon={X} onClick={tap(close)} ariaLabel="Close" />
            </div>
          )}
        </div>
        <div className="sheet-body">
          {children}
          {footer && <div className="sheet-actions">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Confirmation sheet, e.g. for destructive actions. */
export function ConfirmSheet({
  title,
  message,
  confirmLabel,
  destructive,
  onConfirm,
  onClose,
}: {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={title} onClose={onClose}>
      {message && <p style={{ margin: '0 4px 14px', color: 'var(--label-2)', fontSize: 15, lineHeight: 1.4 }}>{message}</p>}
      <div className="sheet-actions">
        <button
          type="button"
          className={`btn block ${destructive ? 'danger' : 'primary'}`}
          disabled={busy}
          onClick={tap(async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
              onClose();
            }
          })}
        >
          {confirmLabel}
        </button>
        <button type="button" className="btn block secondary" onClick={tap(onClose)}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

/** Text input sheet (iOS-style alert with a field). */
export function PromptSheet({
  title,
  message,
  initial = '',
  placeholder,
  confirmLabel = 'Save',
  onSubmit,
  onClose,
}: {
  title: string;
  message?: ReactNode;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, []);
  const submit = async () => {
    if (!value.trim()) return;
    await onSubmit(value.trim());
    onClose();
  };
  return (
    <Sheet title={title} onClose={onClose}>
      {message && <p style={{ margin: '0 4px 12px', color: 'var(--label-2)', fontSize: 15, lineHeight: 1.4 }}>{message}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          ref={inputRef}
          className="text-field"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          maxLength={60}
          enterKeyHint="done"
        />
        <div className="sheet-actions" style={{ paddingTop: 14 }}>
          <button type="submit" className="btn block primary" disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
