// Captured photos, kept outside React so they survive a layout switch (phone rotated past 768px), a route change,
// and (best effort, via sessionStorage) the page reload iOS sometimes does after the camera closes.
// Photos are only cleared after the server has them.
import { useSyncExternalStore } from 'react';
import type { StepKey } from './copy';

export interface ItemShots {
  shots: Partial<Record<StepKey, string>>; // step -> JPEG data URL
  skipped: StepKey[];
  retakes: Record<number, string>; // photo_requests index -> JPEG data URL
}

const EMPTY: ItemShots = { shots: {}, skipped: [], retakes: {} };
const KEY = 'offload.runner.shots';

function normalise(v: unknown): Record<string, ItemShots> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, ItemShots> = {};
  for (const [id, raw] of Object.entries(v as Record<string, Partial<ItemShots>>)) {
    if (!raw || typeof raw !== 'object') continue;
    out[id] = {
      shots: raw.shots && typeof raw.shots === 'object' ? raw.shots : {},
      skipped: Array.isArray(raw.skipped) ? raw.skipped : [],
      retakes: raw.retakes && typeof raw.retakes === 'object' ? raw.retakes : {},
    };
  }
  return out;
}

function load(): Record<string, ItemShots> {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? normalise(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

let book: Record<string, ItemShots> = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(book));
  } catch {
    // Too big or blocked: memory still has every photo. Drop the stale copy so a reload can't bring back old ones.
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
}

function emit() {
  persist();
  listeners.forEach((l) => l());
}

export function updateShots(itemId: string, fn: (s: ItemShots) => ItemShots) {
  book = { ...book, [itemId]: fn(book[itemId] || EMPTY) };
  emit();
}

export function clearShots(itemId: string) {
  if (!book[itemId]) return;
  const next = { ...book };
  delete next[itemId];
  book = next;
  emit();
}

export const getShots = (itemId: string): ItemShots => book[itemId] || EMPTY;
export const shotIds = (): string[] => Object.keys(book);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useShots(itemId: string | null): ItemShots {
  return useSyncExternalStore(
    subscribe,
    () => (itemId && book[itemId]) || EMPTY,
    () => EMPTY,
  );
}

// Helpers used by the flow
export const setShot = (itemId: string, step: StepKey, dataUrl: string) =>
  updateShots(itemId, (s) => ({ ...s, shots: { ...s.shots, [step]: dataUrl }, skipped: s.skipped.filter((k) => k !== step) }));

export const skipStep = (itemId: string, step: StepKey) =>
  updateShots(itemId, (s) => {
    const shots = { ...s.shots };
    delete shots[step];
    return { ...s, shots, skipped: s.skipped.includes(step) ? s.skipped : [...s.skipped, step] };
  });

export const setRetake = (itemId: string, index: number, dataUrl: string) =>
  updateShots(itemId, (s) => ({ ...s, retakes: { ...s.retakes, [index]: dataUrl } }));
