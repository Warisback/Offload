// Polls GET /api/state every 1.5 s for the whole app.
// No overlapping polls, aborts on unmount, and a poll that started before a mutation can never overwrite its result.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, errorMessage } from './api';
import { POLL_MS } from './config';
import type { AppState } from '../types';

type Kind = keyof AppState;
type Row = AppState[Kind][number];

interface StateCtx {
  state: AppState | null;
  error: string | null;
  online: boolean;
  lastUpdated: number | null;
  refresh: () => Promise<void>;
  // Put a row the server just returned into local state straight away (then the next poll confirms it).
  upsert: <K extends Kind>(kind: K, row: AppState[K][number]) => void;
}

const Ctx = createContext<StateCtx | null>(null);

function replaceOrAppend<T extends { id: string }>(list: T[], row: T): T[] {
  const i = list.findIndex((r) => r.id === row.id);
  if (i === -1) return [...list, row];
  const next = list.slice();
  next[i] = row;
  return next;
}

export function StateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const epoch = useRef(0); // bumped by every local write
  const inflight = useRef<AbortController | null>(null);
  const running = useRef<Promise<void> | null>(null);

  const poll = useCallback(async () => {
    if (running.current) return running.current; // never overlap
    const startedAt = epoch.current;
    const ctrl = new AbortController();
    inflight.current = ctrl;
    running.current = (async () => {
      try {
        const next = await api.state(ctrl.signal);
        if (ctrl.signal.aborted || startedAt !== epoch.current) return; // stale: a write happened meanwhile
        setState(next);
        setError(null);
        setLastUpdated(Date.now());
      } catch (e) {
        if (!ctrl.signal.aborted) setError(errorMessage(e));
      } finally {
        running.current = null;
        if (inflight.current === ctrl) inflight.current = null;
      }
    })();
    return running.current;
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await poll();
      if (!stopped) timer = setTimeout(loop, POLL_MS);
    };
    loop();
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      stopped = true;
      clearTimeout(timer);
      inflight.current?.abort();
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [poll]);

  const upsert = useCallback(<K extends Kind>(kind: K, row: AppState[K][number]) => {
    epoch.current++;
    setState((s) => (s ? { ...s, [kind]: replaceOrAppend(s[kind] as Row[] as { id: string }[], row as { id: string }) } : s));
  }, []);

  const refresh = useCallback(async () => {
    epoch.current++;
    inflight.current?.abort(); // drop any poll that started before the write
    running.current = null;
    await poll();
  }, [poll]);

  const value = useMemo(() => ({ state, error, online, lastUpdated, refresh, upsert }), [state, error, online, lastUpdated, refresh, upsert]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): StateCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppState must be used inside <StateProvider>');
  return v;
}

// Runs one mutation at a time with pending/error state, then refreshes. Double submits are ignored.
export function useMutation<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const { refresh } = useAppState();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      if (busy.current) return undefined;
      busy.current = true;
      setPending(true);
      setError(null);
      try {
        const out = await fn(...args);
        refresh();
        return out;
      } catch (e) {
        setError(errorMessage(e));
        return undefined;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [fn, refresh],
  );
  return { run, pending, error, clearError: () => setError(null) };
}
