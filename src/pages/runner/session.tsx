// Runner session: lives above the phone/desktop switch so rotating a phone (or resizing) never loses
// the name, the item in focus, a running upload, or the celebration.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useAppState } from '../../lib/state';
import { myRunnerName, pickupById, sameName, setMyRunnerName } from '../../lib/selectors';
import type { Item, Job } from '../../types';
import { clearShots, shotIds } from './photoBook';
import { isPending, type StepKey } from './copy';

export interface Celebration {
  jobId: string;
  pickupId: string;
  count: number;
  pay: number;
}

interface UploadState {
  pending: boolean;
  error: string | null;
  kind: 'first' | 'retake';
}

interface Flow {
  focusId: string | null; // item the runner chose (null = first one still to do)
  resultId: string | null; // item whose grade is on screen
  pick: Record<string, StepKey | null>; // step picked for a retake, per item
}

interface Session {
  name: string | null;
  setName: (n: string | null) => void;
  celebrate: Celebration | null;
  setCelebrate: (c: Celebration | null) => void;
  skipped: string[]; // pickup jobs where the runner went straight to photos
  skipCollect: (jobId: string) => void;
  taken: Job[]; // jobs someone else got first
  addTaken: (j: Job) => void;
  dismissTaken: (id: string) => void;
  preferred: string | null; // pickup job the runner chose to work on (just accepted, or switched to)
  setPreferred: (id: string | null) => void;
  flow: Flow;
  setFlow: (fn: (f: Flow) => Flow) => void;
  uploads: Record<string, UploadState>;
  upload: (itemId: string, photos: string[], kind: UploadState['kind']) => Promise<Item | undefined>;
  clearUploadError: (itemId: string) => void;
}

const Ctx = createContext<Session | null>(null);

export function RunnerSession({ children }: { children: ReactNode }) {
  const { state, upsert, refresh } = useAppState();
  const [name, setNameState] = useState<string | null>(() => myRunnerName());
  const [celebrate, setCelebrate] = useState<Celebration | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [taken, setTaken] = useState<Job[]>([]);
  const [preferred, setPreferred] = useState<string | null>(null);
  const [flow, setFlowState] = useState<Flow>({ focusId: null, resultId: null, pick: {} });
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const inflight = useRef(new Set<string>());
  const seenOpen = useRef(new Set<string>());

  const setName = useCallback((n: string | null) => {
    setMyRunnerName(n);
    setNameState(n);
    seenOpen.current.clear();
    setTaken([]);
    setPreferred(null);
  }, []);

  const setFlow = useCallback((fn: (f: Flow) => Flow) => setFlowState(fn), []);
  const skipCollect = useCallback((id: string) => setSkipped((s) => (s.includes(id) ? s : [...s, id])), []);
  const addTaken = useCallback((j: Job) => setTaken((t) => [...t.filter((x) => x.id !== j.id), j]), []);
  const dismissTaken = useCallback((id: string) => setTaken((t) => t.filter((x) => x.id !== id)), []);
  const clearUploadError = useCallback(
    (id: string) => setUploads((u) => (u[id] ? { ...u, [id]: { ...u[id], error: null } } : u)),
    [],
  );

  // Notice when a pickup I could see gets taken by someone else, so the card can say so kindly.
  useEffect(() => {
    if (!state || !name) return;
    const newly: Job[] = [];
    for (const j of state.jobs) {
      if (j.type !== 'pickup') continue;
      if (j.status === 'open') seenOpen.current.add(j.id);
      else if (seenOpen.current.has(j.id)) {
        seenOpen.current.delete(j.id);
        if (!sameName(j.runner_name, name)) newly.push(j);
      }
    }
    setTaken((t) => {
      // Forget cards whose job vanished (demo reset) or opened up again.
      const alive = t.filter((x) => state.jobs.some((j) => j.id === x.id && j.status !== 'open'));
      const merged = newly.length ? [...alive.filter((x) => !newly.some((n) => n.id === x.id)), ...newly] : alive;
      return merged.length === t.length && merged.every((x, i) => x === t[i]) ? t : merged;
    });
    // A celebration for a pickup that no longer exists (reset) goes away.
    setCelebrate((c) => (c && !pickupById(state, c.pickupId) ? null : c));
  }, [state, name]);

  // Photos for an item the server already has sorted (the demo P key, an upload that timed out here but landed there)
  // are dead weight: drop them so memory and the sessionStorage copy stay small. Unknown ids are kept, never guessed at.
  useEffect(() => {
    if (!state) return;
    for (const id of shotIds()) {
      const it = state.items.find((i) => i.id === id);
      if (it && !isPending(it) && !inflight.current.has(id)) clearShots(id);
    }
  }, [state]);

  const upload = useCallback(
    async (itemId: string, photos: string[], kind: UploadState['kind']) => {
      if (inflight.current.has(itemId) || !photos.length) return undefined;
      inflight.current.add(itemId);
      setUploads((u) => ({ ...u, [itemId]: { pending: true, error: null, kind } }));
      try {
        const item = await api.uploadPhotos(itemId, photos);
        upsert('items', item);
        clearShots(itemId); // the server has them now
        setFlowState((f) => ({
          ...f,
          focusId: itemId,
          resultId: item.status === 'needs_photos' ? null : itemId,
          pick: { ...f.pick, [itemId]: null },
        }));
        setUploads((u) => ({ ...u, [itemId]: { pending: false, error: null, kind } }));
        refresh();
        return item;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          // Already listed (someone else finished it): nothing to fix, move on.
          clearShots(itemId);
          setUploads((u) => ({ ...u, [itemId]: { pending: false, error: null, kind } }));
          refresh();
          return undefined;
        }
        setUploads((u) => ({ ...u, [itemId]: { pending: false, error: errorMessage(e), kind } }));
        return undefined;
      } finally {
        inflight.current.delete(itemId);
      }
    },
    [upsert, refresh],
  );

  const value = useMemo<Session>(
    () => ({
      name,
      setName,
      celebrate,
      setCelebrate,
      skipped,
      skipCollect,
      taken,
      addTaken,
      dismissTaken,
      preferred,
      setPreferred,
      flow,
      setFlow,
      uploads,
      upload,
      clearUploadError,
    }),
    [name, setName, celebrate, skipped, skipCollect, taken, addTaken, dismissTaken, preferred, flow, setFlow, uploads, upload, clearUploadError],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRunner(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRunner must be used inside <RunnerSession>');
  return v;
}
