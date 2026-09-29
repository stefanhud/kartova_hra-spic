import { useEffect, useState, type RefObject } from 'react';

// Current time, ticking every `ms` while `active`. Starts at 0 until the first tick.
export function useNow(active: boolean, ms = 250) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, ms);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [active, ms]);
  return now;
}

// Size of an element, kept up to date with a ResizeObserver.
export function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0].contentRect;
      setSize(s => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// Keep the phone screen awake while seated, so the connection isn't suspended mid-hand.
// Some phones (iOS Safari especially) only grant the lock after a tap and drop it whenever
// the page is hidden, so it is re-requested on every return to the page and on taps.
type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener?: (type: 'release', cb: () => void) => void };

export function useWakeLock(active: boolean) {
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } };
    if (!active || !nav.wakeLock) return;
    let lock: WakeLockSentinelLike | null = null;
    let pending = false;
    let cancelled = false;
    const acquire = () => {
      if (cancelled || lock || pending || document.visibilityState !== 'visible') return;
      pending = true;
      nav.wakeLock!.request('screen')
        .then(l => {
          pending = false;
          if (cancelled) {
            l.release().catch(() => {});
            return;
          }
          lock = l;
          l.addEventListener?.('release', () => {
            lock = null;
          });
        })
        .catch(() => {
          pending = false;
        });
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    window.addEventListener('pointerdown', acquire, true);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      window.removeEventListener('pointerdown', acquire, true);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
