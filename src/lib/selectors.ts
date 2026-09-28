// Derived views over the polled state. Pure functions; pages never re-implement these.
import type { AppState, FeedEvent, Item, ItemStatus, Job, Ledger, Offer, Pickup, PriceSource } from '../types';

export const byCreated = (a: Pickup, b: Pickup) => a.created_at.localeCompare(b.created_at);

export const latestPickup = (s: AppState): Pickup | null => (s.pickups.length ? [...s.pickups].sort(byCreated).at(-1)! : null);
export const pickupById = (s: AppState, id: string | null | undefined) => (id ? s.pickups.find((p) => p.id === id) || null : null);
export const itemById = (s: AppState, id: string | null | undefined) => (id ? s.items.find((i) => i.id === id) || null : null);
export const itemsOf = (s: AppState, pickupId: string) => s.items.filter((i) => i.pickup_id === pickupId);

export const offersFor = (s: AppState, itemId: string): Offer[] => s.offers.filter((o) => o.item_id === itemId);
export const latestOffer = (s: AppState, itemId: string): Offer | null => offersFor(s, itemId).at(-1) || null;
export const ledgerFor = (s: AppState, itemId: string): Ledger | null => s.ledger.find((l) => l.item_id === itemId) || null;

export const pickupJob = (s: AppState, pickupId: string): Job | null =>
  s.jobs.find((j) => j.type === 'pickup' && j.pickup_id === pickupId) || null;
export const postJobs = (s: AppState): Job[] => s.jobs.filter((j) => j.type === 'post');

export function ledgerOfPickup(s: AppState, pickupId: string): Ledger[] {
  const ids = new Set(itemsOf(s, pickupId).map((i) => i.id));
  return s.ledger.filter((l) => ids.has(l.item_id));
}

// What the seller has earned (70% of each sale). There is no payout status in the contract: earned, not "paid".
export const sellerEarned = (s: AppState, pickupId?: string) =>
  (pickupId ? ledgerOfPickup(s, pickupId) : s.ledger).reduce((sum, l) => sum + l.seller_amount, 0);
export const soldTotal = (s: AppState, pickupId?: string) =>
  (pickupId ? ledgerOfPickup(s, pickupId) : s.ledger).reduce((sum, l) => sum + l.sale_price, 0);

// Names are the runner's only identity. The backend trims them; "sam" and "Sam " are the same person.
export const sameName = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b) && a!.trim().toLowerCase() === b!.trim().toLowerCase();

// Runner earnings come from ONE source: pickup job pay (600p per item covers collection AND posting).
// Post jobs show their £6 as a label only; adding them too would count the same money twice.
export function runnerEarned(s: AppState, runnerName?: string | null) {
  return s.jobs
    .filter((j) => j.type === 'pickup' && j.status === 'done' && (!runnerName || sameName(j.runner_name, runnerName)))
    .reduce((sum, j) => sum + j.pay, 0);
}

export const eventsNewestFirst = (s: AppState): FeedEvent[] => [...s.events].sort((a, b) => b.ts.localeCompare(a.ts));

export const isOnSale = (i: Item) => i.status === 'listed' || i.status === 'offer';
export const isSold = (i: Item) => i.status === 'sold' || i.status === 'posted';

export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  comps: 'web matches',
  seller: "seller's price",
  table: 'our table',
};

export const STATUS_LABEL: Record<ItemStatus, string> = {
  estimated: 'Estimated',
  needs_photos: 'Needs a photo',
  photographed: 'Photographed',
  listed: 'Listed',
  offer: 'Offer in',
  sold: 'Sold',
  posted: 'Posted',
};

export const GRADE_LABEL: Record<string, string> = {
  A: 'Like new',
  B: 'Good, light wear',
  C: 'Worn, some marks',
  D: 'Well worn',
};

// Middle comps price, for "Similar ones sell around £30".
export function compsMedian(item: Item): number | null {
  const p = item.comps.map((c) => c.price).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (p.length < 2) return null;
  const m = Math.floor(p.length / 2);
  return p.length % 2 ? p[m] : Math.round((p[m - 1] + p[m]) / 2);
}

// ---- per-device memory (never shared; survives reloads) ----

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string | null) {
  try {
    if (v) localStorage.setItem(key, v);
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
export const myPickupId = () => read('offload.pickup');
export const setMyPickupId = (id: string | null) => write('offload.pickup', id);
export const myRunnerName = () => read('offload.runner');
export const setMyRunnerName = (name: string | null) => write('offload.runner', name);
export const mySellerName = () => read('offload.seller');
export const setMySellerName = (name: string | null) => write('offload.seller', name);
export const myAddress = () => read('offload.address');
export const setMyAddress = (a: string | null) => write('offload.address', a);
