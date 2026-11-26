/** Small wrappers around device APIs that degrade gracefully on iOS Safari. */

let hapticLabel: HTMLLabelElement | null = null;

/**
 * Light haptic tap. Uses the Vibration API where it exists; on iOS 18+ Safari, toggling a native
 * `<input type="checkbox" switch>` inside a user gesture produces a system haptic.
 */
export function haptic(): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator && typeof navigator.vibrate === 'function') {
      navigator.vibrate(12);
      return;
    }
    if (!hapticLabel) {
      hapticLabel = document.createElement('label');
      hapticLabel.ariaHidden = 'true';
      hapticLabel.style.cssText = 'position:fixed;left:-100px;top:-100px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      hapticLabel.appendChild(input);
      document.body.appendChild(hapticLabel);
    }
    hapticLabel.click();
  } catch {
    /* no haptics available */
  }
}

export function speak(text: string): void {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  } catch {
    /* speech unavailable */
  }
}

/** Spoken form of a duration: "5 minutes 32 seconds". */
export function spokenDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (sec || !m) parts.push(`${sec} second${sec === 1 ? '' : 's'}`);
  return parts.join(' ');
}

export function spokenDelta(ms: number, what: string): string {
  const s = Math.abs(ms) / 1000;
  const amount = s >= 60 ? spokenDuration(Math.abs(ms)) : `${s.toFixed(1)} seconds`;
  return `${amount} ${ms < 0 ? 'faster' : 'slower'} than ${what}`;
}

type WakeLockSentinelLike = { release(): Promise<void>; released: boolean; addEventListener(t: 'release', f: () => void): void };

let sentinel: WakeLockSentinelLike | null = null;
let wanted = false;

async function acquireWakeLock(): Promise<void> {
  const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } }).wakeLock;
  if (!wl || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
  try {
    sentinel = await wl.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    /* denied (low power mode) or unsupported */
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible') void acquireWakeLock();
  });
}

/** Keep the screen on while recording so GPS keeps flowing (iOS pauses web apps when locked). */
export function setKeepAwake(on: boolean): void {
  wanted = on;
  if (on) void acquireWakeLock();
  else if (sentinel) {
    void sentinel.release();
    sentinel = null;
  }
}

export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

export function isStandalone(): boolean {
  return (
    (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* ignore */
  }
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Share a file via the iOS share sheet when possible, otherwise download it. */
export async function shareOrDownload(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  download(blob, filename);
}
