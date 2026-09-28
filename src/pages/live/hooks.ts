// Small hooks for the projector screen: a ticking clock, relative times, and "what arrived after the page loaded".
import { useEffect, useRef, useState } from 'react';

// Re-renders every `ms` so "2 min ago" keeps moving on a screen nobody touches.
export function useNow(ms = 10_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const hhmm = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

// "just now", "1 min ago", "14 min ago", "2 hours ago", then a clock time. Future stamps (clock skew) read as "just now".
export function relativeTime(ts: string, now: number): string {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 45) return 'just now';
  const m = Math.max(1, Math.round(s / 60));
  if (m < 60) return m === 1 ? '1 min ago' : `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 6) return h === 1 ? '1 hour ago' : `${h} hours ago`;
  const d = new Date(t);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return `Today, ${hhmm(t)}`;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${hhmm(t)}`;
}

// Remembers the ids present in the first loaded state. Anything not in that set arrived live and gets the "new" treatment
// (glow, count-up, stamp); things that were already there on load render calmly, without replaying history.
export function useFreshIds(ids: readonly string[] | null): (id: string) => boolean {
  const base = useRef<Set<string> | null>(null);
  if (base.current === null && ids) base.current = new Set(ids); // lazy init, once
  const seen = base.current;
  return (id: string) => seen !== null && !seen.has(id);
}
