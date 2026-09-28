// In-browser mock of the offload backend. It answers every contract route, so the UI runs with no server
// (VITE_USE_MOCK=true, no VITE_API_BASE, or ?api=mock).
//
// It mirrors server/src/flows.js, pricing.js and demo.js: the same pricing rule, preview ranges, counter-offers, money
// split, job pay, statuses and feed wording, and the same idempotency (booking twice returns the same job, a sale is
// recorded once, a job marked done twice is a no-op, offers on sold items are rejected). It acts like a backend whose
// Claude/Gemini answers come from the demo cache and whose Shopify hands out discount codes but no product pages
// (new listings keep shopify_url null, so the UI shows no checkout link for them; the seed's own items keep theirs).
// The demo sale uses the cache's discount code, like the server does when Shopify can't make one.
// Live filming walks a fixed script of LIVE_PROMPTS through the demo pile and ends on "Looks good, you can stop".
//
// State: /mock/seed.json (the reset state) and /mock/demo.json (the demo pile) are fetched on first use, then state lives
// in memory and is saved to localStorage["offload.mock.state"]. Changing either file throws the saved state away.
//   - Each browser (each browser profile, each device) has its OWN mock state. A judge's phone and the projector share
//     nothing, so cross-device demos need the real backend.
//   - Tabs of the same browser stay roughly in sync through the 'storage' event (the last write wins).
//   - If photos overflow the storage quota they are saved as 480px copies (grey placeholders until those are ready),
//     and as placeholders only if even that won't fit. The tab that took them keeps the full-size originals in memory.
// Deterministic: ids are prefix + counter (i_m0001), latency is 150-400 ms from a call counter, no Math.random anywhere.
import { ApiError } from './api';
import { LIVE_PROMPTS } from '../types';
import type {
  AppState,
  Comp,
  Confidence,
  FeedEvent,
  Grade,
  Item,
  Job,
  Ledger,
  LiveFrameReply,
  LivePrompt,
  Offer,
  Pence,
  Pickup,
  PriceSource,
} from '../types';

// ---------------------------------------------------------------- types

type Kind = keyof AppState;
type Body = Record<string, unknown>;

// Internal fields the real backend keeps in item.meta (never sent to the UI).
interface Meta {
  brand_tier?: string;
  type_label?: string;
  search_query?: string | null;
  claim_noun?: string | null;
  claim_line?: string | null;
  story_safe?: string | null;
  proof_note?: string | null;
  demo_key?: string | null;
  demo?: boolean;
  retake_rounds?: number;
  request_summary?: string | null;
  asked_price?: boolean;
  comps_warned?: boolean;
  claim_off_told?: boolean;
}
type MItem = Item & { meta: Meta };
interface MState {
  pickups: Pickup[];
  items: MItem[];
  jobs: Job[];
  offers: Offer[];
  ledger: Ledger[];
  events: FeedEvent[];
}
type Row<K extends Kind> = MState[K][number];

interface CacheItem {
  key: string;
  match?: string[];
  label: string;
  brand: string | null;
  type: string;
  type_label?: string;
  size: string | null;
  brand_tier?: string;
  seller_story?: string | null;
  story_safe?: string | null;
  claim?: string | null;
  claim_noun?: string | null;
  claim_line?: string | null;
  seller_ask?: number | null;
  proof_request?: string | null;
  search_query?: string | null;
  estimate_notes?: string[];
  grade?: Grade | null;
  condition_notes?: string[];
  special?: string | null;
  photos?: string[];
  claim_proof?: string | null;
  retake?: { photo_requests?: string[]; request_summary?: string | null; photos_after?: string[]; claim_proof?: string | null } | null;
  comps?: Comp[];
}
interface DemoCache {
  seller_name?: string;
  address?: string;
  runner_name?: string;
  transcript?: string;
  items: CacheItem[];
  sale?: { item_key?: string; buyer?: string; first_offer?: number; discount_code?: string | null };
}

// What an estimate looks like before cleaning (Claude's output, or a demo cache item).
interface RawEstimate {
  label?: string;
  type_label?: string;
  brand?: string | null;
  type?: string;
  size?: string | null;
  brand_tier?: string;
  condition_notes?: unknown;
  special?: string | null;
  claim?: string | null;
  claim_noun?: string | null;
  claim_line?: string | null;
  seller_ask?: unknown;
  seller_story?: string | null;
  story_safe?: string | null;
  proof_request?: string | null;
  search_query?: string | null;
  demo_key?: string | null;
}

interface Snapshot {
  v: 1;
  sig: string;
  seq: number;
  liveCalls: number;
  lastTs: string;
  state: MState;
}

// ---------------------------------------------------------------- module state

const STORAGE_KEY = 'offload.mock.state';
const KINDS: Kind[] = ['pickups', 'items', 'jobs', 'offers', 'ledger', 'events'];
const PHOTO_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 3 4'%3E%3Crect width='3' height='4' fill='%23e9e4da'/%3E%3C/svg%3E";

let seed: AppState | null = null;
let cache: DemoCache | null = null;
let seedSig = '';
let db: MState = { pickups: [], items: [], jobs: [], offers: [], ledger: [], events: [] };
let seq = 0; // id counter, never reset so old ids can't come back after a reset
let liveCalls = 0;
let lastTs = '';
let calls = 0; // drives the artificial latency
let generation = 0; // bumped on reset so running demo sequences stop quietly
let ready: Promise<void> | null = null;
let listening = false;
const busy = new Set<string>();
const running = new Set<Promise<void>>();
const timing = { latency: 1, steps: 1 };

// ---------------------------------------------------------------- small helpers (server/src/util.js)

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const roundPounds = (pence: number) => Math.max(100, Math.round(pence / 100) * 100);

function toPence(v: unknown): Pence | null {
  if (v == null || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// 3800 -> "£38", 2660 -> "£26.60" (same as the server's gbp(), used in feed text)
function gbp(pence: number | null | undefined): string {
  if (pence == null || !Number.isFinite(pence)) return '';
  const v = Math.abs(Math.round(pence));
  const s = v % 100 === 0 ? String(v / 100) : (v / 100).toFixed(2);
  return `${pence < 0 ? '-' : ''}£${s}`;
}

const clip = (s: string | null | undefined, n: number) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
const norm = (s: string | null | undefined) =>
  (s || '').toLowerCase().replace(/[^a-z0-9£' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim()) : [];
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.length > 0) : []);

function newId(prefix: string) {
  seq += 1;
  return `${prefix}_m${String(seq).padStart(4, '0')}`;
}

// Feed timestamps never go backwards, so the feed order is stable.
function stamp() {
  let ts = new Date().toISOString();
  if (ts <= lastTs) ts = new Date(Date.parse(lastTs) + 1).toISOString();
  lastTs = ts;
  return ts;
}

// Deep copy of plain JSON data. Strings are shared, so copying state full of data URLs stays cheap.
function clone<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clone) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = clone(x);
    return out as T;
  }
  return v;
}

// FNV-1a, for discount codes that look random but are the same every run.
function hashCode(s: string, len: number) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(len, '0').slice(-len);
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
const sleep = (ms: number) => wait(ms * timing.steps); // demo sequence pauses

function track(p: Promise<unknown>) {
  const q = p.then(
    () => undefined,
    (e) => console.warn('[mock]', e),
  );
  running.add(q);
  q.then(() => running.delete(q));
}

// ---------------------------------------------------------------- pricing (server/src/pricing.js)

const TYPE_BASE: Record<string, number> = { jacket: 3000, jeans: 2000, hoodie: 2000, 't-shirt': 800, dress: 2200, trainers: 3500, other: 1200 };
const BRAND_TIER: Record<string, number> = { designer: 3, premium: 1.8, 'high street': 1, unknown: 0.7 };
const GRADE_MULT: Record<string, number> = { A: 1, B: 0.85, C: 0.65, D: 0.4 };
const SPECIAL_MULT = 1.2;
const ASSUMED_GRADE = 'B';
const ASK_WARN_RATIO = 1.5;
const ASK_FLOOR = 0.8;
const FLOOR = 0.7;
const RUNNER_FEE = 600;
const POST_JOB_PAY = RUNNER_FEE;
const TYPES = Object.keys(TYPE_BASE);
const TIERS = Object.keys(BRAND_TIER);

function median(nums: number[]): number | null {
  const s = [...nums].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

const validPrices = (comps: Comp[] | null | undefined) =>
  (comps || [])
    .map((c) => c?.price)
    .filter((p) => Number.isFinite(p) && p > 0)
    .slice(0, 5);

function compsPrice(comps: Comp[] | null | undefined): number | null {
  const prices = validPrices(comps);
  return prices.length >= 2 ? median(prices) : null;
}

const tableBase = (type: string, tier: string | undefined) =>
  (hasOwn(TYPE_BASE, type) ? TYPE_BASE[type] : TYPE_BASE.other) *
  (tier && hasOwn(BRAND_TIER, tier) ? BRAND_TIER[tier] : BRAND_TIER.unknown);

const mult = (grade: string | null, special: string | null) =>
  (grade && hasOwn(GRADE_MULT, grade) ? GRADE_MULT[grade] : GRADE_MULT[ASSUMED_GRADE]) * (special ? SPECIAL_MULT : 1);

interface PriceInput {
  type: string;
  brand_tier?: string;
  grade?: string | null;
  special?: string | null;
  seller_ask?: number | null;
  comps?: Comp[];
}
interface PriceOut {
  list_price: Pence;
  floor_price: Pence;
  price_source: PriceSource;
  price_confidence: Confidence;
  market: number | null;
  raw: number | null;
  askAboveMarket: boolean;
}

function priceItem({ type, brand_tier, grade = null, special = null, seller_ask = null, comps = [] }: PriceInput): PriceOut {
  const matches = validPrices(comps).length;
  const raw = compsPrice(comps);
  const market = raw != null ? roundPounds(raw * mult(grade, special)) : null;
  const ask = toPence(seller_ask);

  if (ask) {
    const askAboveMarket = market != null && ask >= market * ASK_WARN_RATIO;
    let confidence: Confidence = 'medium';
    if (market != null) confidence = askAboveMarket ? 'low' : ask <= market * 1.25 ? 'high' : 'medium';
    return { list_price: ask, floor_price: Math.round(ask * ASK_FLOOR), price_source: 'seller', price_confidence: confidence, market, raw, askAboveMarket };
  }
  if (market != null) {
    return {
      list_price: market,
      floor_price: Math.round(market * FLOOR),
      price_source: 'comps',
      price_confidence: matches >= 4 ? 'high' : 'medium',
      market,
      raw,
      askAboveMarket: false,
    };
  }
  const listPrice = roundPounds(tableBase(type, brand_tier) * mult(grade, special));
  return { list_price: listPrice, floor_price: Math.round(listPrice * FLOOR), price_source: 'table', price_confidence: 'low', market: null, raw: null, askAboveMarket: false };
}

// Worn (C) to like-new (A); a seller ask shows as floor..ask.
function previewRange({ type, brand_tier, special = null, seller_ask = null, comps = [] }: PriceInput) {
  const ask = toPence(seller_ask);
  if (ask) return { low: Math.round(ask * ASK_FLOOR), high: ask };
  const base = compsPrice(comps) ?? tableBase(type, brand_tier);
  const s = special ? SPECIAL_MULT : 1;
  return { low: roundPounds(base * GRADE_MULT.C * s), high: roundPounds(base * GRADE_MULT.A * s) };
}

// Round-1 counter: midpoint in whole pounds, never below floor or above list.
function counterOffer(amount: number, listPrice: number, floorPrice: number) {
  const mid = Math.round((amount + listPrice) / 2 / 100) * 100;
  return Math.min(listPrice, Math.max(floorPrice, mid));
}

// Seller 70%, runner flat 600p, we keep the rest (can be negative on very cheap sales).
function split(sale_price: number) {
  const seller_amount = Math.round(sale_price * 0.7);
  return { sale_price, seller_amount, runner_amount: RUNNER_FEE, our_amount: sale_price - seller_amount - RUNNER_FEE };
}

// ---------------------------------------------------------------- state access

function find<K extends Kind>(kind: K, id: unknown): Row<K> | null {
  if (typeof id !== 'string') return null;
  return ((db[kind] as Row<K>[]).find((r) => r.id === id) as Row<K> | undefined) ?? null;
}
const itemsOf = (pickupId: string) => db.items.filter((i) => i.pickup_id === pickupId);
const pickupJobOf = (pickupId: string) => db.jobs.find((j) => j.type === 'pickup' && j.pickup_id === pickupId) || null;

function need<K extends Kind>(kind: K, id: unknown, what: string): Row<K> {
  const row = find(kind, id);
  if (!row) throw new ApiError(404, `No ${what} with id ${String(id)}.`);
  return row;
}

function publicItem(it: MItem): Item {
  const { meta: _meta, ...rest } = it;
  return rest;
}
const publicState = (): AppState => ({
  pickups: db.pickups,
  items: db.items.map(publicItem),
  jobs: db.jobs,
  offers: db.offers,
  ledger: db.ledger,
  events: db.events,
});

function event(actor: FeedEvent['actor'], text: string, money: number | null = null) {
  const e: FeedEvent = { id: newId('e'), ts: stamp(), actor, text, money: money == null ? null : Math.round(money) };
  db.events.push(e);
  return e;
}

// ---------------------------------------------------------------- flows (server/src/flows.js)

const demoItem = (key: string | null | undefined) => (key && cache?.items.find((i) => i.key === key)) || null;

function matchDemo(label: string, brand: string | null) {
  const hay = norm(`${label} ${brand || ''}`);
  return cache?.items.find((ci) => ci.match?.length && ci.match.every((w) => hay.includes(norm(w)))) || null;
}

const COMMON = new Set(
  (
    'vintage retro old classic unbranded custom customised customized handmade hand-made hand-painted painted hand signed ' +
    'embroidered wool knit knitted cotton linen silk suede leather faux denim corduroy cashmere fleece quilted waxed wax ' +
    'black white blue grey gray red green navy brown pink cream beige khaki olive yellow orange purple light dark washed ' +
    'hand-embroidered hand-knitted reworked upcycled patchwork teal burgundy maroon mustard lilac lavender ivory charcoal camel rust sage coral mint tan gold silver multicoloured ' +
    'distressed ripped oversized cropped baggy slim straight wide plain striped floral check checked tartan graphic long ' +
    'short sleeveless puffer bomber trucker chunky mini midi maxi summer winter little big football basketball band tour ' +
    'jacket jeans hoodie sweatshirt jumper cardigan coat shirt tee t-shirt dress skirt trousers shorts blazer trainers boots'
  ).split(' '),
);

// "the Levi's denim jacket", "the hand-painted denim jacket"
function the(item: { label: string }) {
  const l = item.label || 'item';
  const first = l.split(/\s+/)[0].toLowerCase().replace(/[^a-z-]/g, '');
  return `the ${COMMON.has(first) ? l.charAt(0).toLowerCase() + l.slice(1) : l}`;
}
const sellerOf = (item: Item) => find('pickups', item.pickup_id)?.seller_name || 'The seller';
const shortAddress = (a: string) => (a || '').split(',')[0].trim() || 'the seller';

function applyPrice(item: MItem) {
  const p = priceItem({
    type: item.type,
    brand_tier: item.meta.brand_tier,
    grade: item.grade,
    special: item.special,
    seller_ask: item.seller_ask,
    comps: item.comps,
  });
  item.list_price = p.list_price;
  item.floor_price = p.floor_price;
  item.price_source = p.price_source;
  item.price_confidence = p.price_confidence;
  return p;
}

function refreshPreview(pickup: Pickup) {
  pickup.preview = itemsOf(pickup.id).map((it) => ({
    label: it.label,
    ...previewRange({ type: it.type, brand_tier: it.meta.brand_tier, special: it.special, seller_ask: it.seller_ask, comps: it.comps }),
  }));
  pickup.estimate_low = pickup.preview.reduce((s, p) => s + p.low, 0);
  pickup.estimate_high = pickup.preview.reduce((s, p) => s + p.high, 0);
}

function cleanEstimate(e: RawEstimate) {
  const type = e.type && TYPES.includes(e.type) ? e.type : 'other';
  const brand = e.brand ? String(e.brand).trim() : null;
  const claim = e.claim ? String(e.claim).trim() : null;
  return {
    label: clip(String(e.label || e.type_label || 'Item').trim(), 80),
    brand,
    type,
    type_label: e.type_label || type,
    size: e.size ? String(e.size).trim() : null,
    brand_tier: e.brand_tier && TIERS.includes(e.brand_tier) ? e.brand_tier : brand ? 'high street' : 'unknown',
    condition_notes: list(e.condition_notes),
    special: e.special || null,
    claim,
    claim_noun: claim ? e.claim_noun || 'it' : null,
    claim_line: claim ? e.claim_line || null : null,
    seller_ask: toPence(e.seller_ask),
    seller_story: e.seller_story || null,
    story_safe: claim ? e.story_safe || null : null,
    proof_request: claim ? e.proof_request || `You said it's ${claim}. Do you have a photo of that, a receipt or a certificate?` : null,
    search_query: e.search_query || null,
    demo_key: e.demo_key || null,
  };
}
type Estimate = ReturnType<typeof cleanEstimate>;

// A demo cache item in the shape Claude's estimate returns.
const estimateFromCache = (ci: CacheItem): RawEstimate => ({
  ...ci,
  condition_notes: ci.estimate_notes || [],
  special: null, // confirmed from the runner's photos
  demo_key: ci.key,
});

function newItem(pickup: Pickup, est: Estimate, demo: boolean): MItem {
  const ci = demoItem(est.demo_key) || matchDemo(est.label, est.brand);
  const item: MItem = {
    id: newId('i'),
    pickup_id: pickup.id,
    label: est.label,
    brand: est.brand,
    type: est.type,
    size: est.size,
    grade: null,
    condition_notes: est.condition_notes,
    special: est.special,
    claim: est.claim,
    claim_proof: null,
    seller_ask: est.seller_ask,
    price_source: 'table',
    price_confidence: 'low',
    seller_story: est.seller_story,
    photo_requests: [],
    proof_request: est.proof_request,
    seller_proof: [],
    photos: [],
    comps: ci ? clone(ci.comps || []) : [], // the backend preloads the demo comps, so they're "cached" from the start
    list_price: 0,
    floor_price: 0,
    shopify_url: null,
    status: 'estimated',
    meta: {
      brand_tier: est.brand_tier,
      type_label: est.type_label,
      search_query: est.search_query,
      claim_noun: est.claim_noun,
      claim_line: est.claim_line,
      story_safe: est.story_safe,
      proof_note: null,
      demo_key: ci?.key || null,
      demo,
      retake_rounds: 0,
    },
  };
  applyPrice(item);
  return item;
}

function resetLive() {
  liveCalls = 0;
  lastFrameAt = 0;
}

function createPickup(o: { seller_name?: unknown; address?: unknown; transcript?: unknown; estimates: RawEstimate[]; demo?: boolean }) {
  const pickup: Pickup = {
    id: newId('p'),
    seller_name: clip(String(o.seller_name ?? '').trim() || 'Seller', 80),
    address: clip(String(o.address ?? '').trim(), 200),
    transcript: String(o.transcript ?? ''),
    estimate_low: 0,
    estimate_high: 0,
    preview: [],
    status: 'estimated',
    runner_name: null,
    created_at: stamp(),
  };
  const items = o.estimates.map(cleanEstimate).map((e) => newItem(pickup, e, Boolean(o.demo)));
  db.pickups.push(pickup);
  db.items.push(...items);
  refreshPreview(pickup);

  const n = items.length;
  if (n) event('agent', `Spotted ${n} item${n === 1 ? '' : 's'}. Expect ${gbp(pickup.estimate_low)} to ${gbp(pickup.estimate_high)}.`, pickup.estimate_high);
  else event('agent', "Couldn't make out any clothes in that video. Mind trying again in better light?");
  for (const it of items) {
    if (it.seller_ask) event('agent', `Noted you want ${gbp(it.seller_ask)} for ${the(it)}.`);
    if (it.proof_request) event('agent', `Asked the seller for proof of ${it.meta.claim_noun}.`);
  }
  resetLive();
  return pickup;
}

function book(pickup: Pickup): Job {
  const existing = pickupJobOf(pickup.id);
  if (existing) return existing;
  const items = itemsOf(pickup.id);
  const job: Job = {
    id: newId('j'),
    type: 'pickup',
    pickup_id: pickup.id,
    item_ids: items.map((i) => i.id),
    runner_name: null,
    address: pickup.address,
    pay: RUNNER_FEE * items.length,
    status: 'open',
  };
  db.jobs.push(job);
  if (pickup.status === 'estimated') pickup.status = 'booked';
  event('agent', 'Runner booked for pickup.');
  return job;
}

function acceptJob(job: Job, runnerName: unknown): Job {
  if (job.status !== 'open') return job; // already taken
  const name = clip(String(runnerName ?? '').trim(), 60) || 'A runner';
  job.status = 'accepted';
  job.runner_name = name;
  if (job.type === 'pickup') {
    const p = find('pickups', job.pickup_id);
    if (p) p.runner_name = name;
    event('runner', `${name} accepted the pickup at ${shortAddress(job.address)}.`);
  } else {
    const it = find('items', job.item_ids[0]);
    event('runner', `${name} is posting ${it ? the(it) : 'the sale'}.`);
  }
  return job;
}

function jobDone(job: Job): Job {
  if (job.status === 'done') return job;
  job.status = 'done';
  const who = job.runner_name || 'The runner';
  if (job.type === 'pickup') {
    const p = find('pickups', job.pickup_id);
    if (p && (p.status === 'estimated' || p.status === 'booked')) p.status = 'collected';
    const n = job.item_ids.length;
    event('runner', `${who} collected ${n} item${n === 1 ? '' : 's'} from ${p?.seller_name || 'the seller'}.`);
  } else {
    const items = job.item_ids.map((i) => find('items', i)).filter((i): i is MItem => Boolean(i));
    for (const it of items) if (it.status === 'sold') it.status = 'posted';
    event('runner', `${who} posted ${items[0] ? the(items[0]) : 'the sale'}. It's on its way to the buyer.`);
  }
  return job;
}

function needsPhotos(item: MItem, requests: unknown, summary: string | null | undefined) {
  item.photo_requests = list(requests).slice(0, 3);
  item.status = 'needs_photos';
  item.meta.retake_rounds = (item.meta.retake_rounds || 0) + 1;
  item.meta.request_summary = summary || null;
  event('agent', `Asked the runner for ${summary || `another photo of ${the(item)}`}.`);
}

function gradingEvents(item: MItem, p: PriceOut) {
  const graded = `Graded ${the(item)} ${item.grade}.`;
  if (p.price_source === 'comps') {
    event('agent', `${graded} Similar ones sell around ${gbp(p.raw)}, so I'll list it at ${gbp(item.list_price)}.`);
  } else if (p.price_source === 'seller') {
    event('agent', `${graded} Listing it at your ${gbp(item.seller_ask)}.`);
  } else {
    event('agent', `${graded} No price matches found, priced from our table at ${gbp(item.list_price)}.`);
    if (!item.meta.asked_price) {
      item.meta.asked_price = true;
      event('agent', `Couldn't find anything like ${the(item)} online. What would you want for it?`);
    }
  }
}

interface GradeInput {
  grade?: Grade | null;
  condition_notes?: string[] | null;
  special?: string | null;
  claim_proof?: string | null;
}

function finishGrading(item: MItem, g: GradeInput, comps: Comp[]) {
  item.grade = g.grade && ['A', 'B', 'C', 'D'].includes(g.grade) ? g.grade : 'B';
  if (Array.isArray(g.condition_notes)) item.condition_notes = list(g.condition_notes);
  if (g.special) item.special = g.special;
  if (item.claim && g.claim_proof) item.claim_proof = g.claim_proof;
  item.photo_requests = [];
  item.comps = clone(comps);
  const p = applyPrice(item);
  item.status = 'photographed';
  gradingEvents(item, p);
  if (find('pickups', item.pickup_id)?.status === 'listed') {
    // Fixed items join the live listing a moment later (the route answers "photographed" first, like the backend).
    const id = item.id;
    track(
      sleep(300).then(() => {
        const it = find('items', id);
        if (it && find('pickups', it.pickup_id)?.status === 'listed') {
          listItem(it);
          persist();
        }
      }),
    );
  }
  return item;
}

function listingWarnings(item: MItem) {
  const p = priceItem({ type: item.type, brand_tier: item.meta.brand_tier, grade: item.grade, special: item.special, seller_ask: item.seller_ask, comps: item.comps });
  if (p.askAboveMarket && !item.meta.comps_warned) {
    item.meta.comps_warned = true;
    event('agent', `Similar ones sell around ${gbp(p.raw)}. Listed at your ${gbp(item.seller_ask)} anyway, I'll tell you if it's slow.`);
  }
  if (item.claim && !item.claim_proof && !item.meta.claim_off_told) {
    item.meta.claim_off_told = true;
    event(
      'agent',
      `Kept "${item.claim}" off the listing for ${the(item)}. There's no clear close-up of ${item.meta.claim_noun || 'it'} yet, and we only say what buyers can see.`,
    );
  }
}

// No Shopify product pages in the mock: the item is listed with shopify_url null.
function listItem(item: MItem) {
  if (item.status !== 'photographed') return item;
  item.status = 'listed';
  event('agent', `Listed ${the(item)} at ${gbp(item.list_price)}.`);
  listingWarnings(item);
  return item;
}

function handover(pickup: Pickup): Pickup {
  const items = itemsOf(pickup.id);
  for (const it of items) {
    if (it.status === 'needs_photos') event('agent', `Holding back ${the(it)} until the runner sends ${it.meta.request_summary || 'better photos'}.`);
    else if (it.status === 'estimated') event('agent', `Holding back ${the(it)} until it's photographed.`);
  }
  for (const it of items) if (it.status === 'photographed') listItem(it);
  const anyListed = items.some((i) => ['listed', 'offer', 'sold', 'posted'].includes(i.status));
  if (anyListed) pickup.status = 'listed';
  else event('agent', "Nothing's ready to list yet. Waiting on the runner's photos.");
  return pickup;
}

// The runner's upload. The demo cache stands in for Claude's photo check; everything else follows the backend.
function photographItem(item: MItem, photos: string[]): MItem {
  item.photos.push(...photos);
  shrinkLater(photos);
  const ci = demoItem(item.meta.demo_key);
  const rounds = item.meta.retake_rounds || 0;

  if (ci?.retake && rounds === 0) {
    if (ci.grade) item.grade = ci.grade; // provisional, visible to the UI
    if (Array.isArray(ci.condition_notes)) item.condition_notes = list(ci.condition_notes);
    needsPhotos(item, ci.retake.photo_requests, ci.retake.request_summary);
    return item;
  }

  // The runner app sends the claim close-up last, after the other shots (a lone photo is never the close-up, like the
  // server's fallback). A retake is the close-up that was asked for. The demo cache says whether Claude found one.
  const closeUp =
    Boolean(item.claim) && (rounds > 0 || (photos.length > 1 && (!ci || Boolean(ci.claim_proof || ci.retake?.claim_proof))));
  finishGrading(
    item,
    {
      grade: ci?.grade ?? item.grade ?? 'B',
      condition_notes: ci?.condition_notes ?? item.condition_notes,
      special: ci?.special ?? item.special,
      claim_proof: closeUp ? photos[photos.length - 1] : null,
    },
    ci ? ci.comps || [] : item.comps,
  );
  return item;
}

function setAsk(item: MItem, ask: Pence | null) {
  item.seller_ask = ask;
  item.meta.comps_warned = false;
  const p = applyPrice(item);
  const pickup = find('pickups', item.pickup_id);
  if (pickup) refreshPreview(pickup);
  event('seller', ask ? `${sellerOf(item)} set ${gbp(ask)} for ${the(item)}.` : `${sellerOf(item)} took their price off ${the(item)}.`);

  if (item.status === 'listed' || item.status === 'offer') {
    event('agent', ask ? `Updated the listing to ${gbp(item.list_price)}.` : `Back to market pricing: ${the(item)} is now ${gbp(item.list_price)}.`);
    listingWarnings(item);
  } else if (p.askAboveMarket) {
    item.meta.comps_warned = true;
    event('agent', `Similar ones sell around ${gbp(p.raw)}. I'll list it at your ${gbp(ask)} anyway and tell you if it's slow.`);
  }
  return item;
}

function addProof(item: MItem, photos: string[], note: string) {
  item.seller_proof.push(...photos);
  shrinkLater(photos);
  item.proof_request = null;
  if (note) item.meta.proof_note = clip(String(note).trim(), 500);
  event('seller', `${sellerOf(item)} sent proof for ${the(item)}.`);
  return item;
}

const LIVE_OFFER = ['pending', 'countered', 'accepted'];

// fallbackCode: the demo's cached code (the server uses it when Shopify can't make one).
function makeOffer(item: MItem, amount: Pence, buyer: unknown, fallbackCode: string | null = null): Offer {
  const who = clip(String(buyer ?? '').trim(), 60) || 'A buyer';
  const round: 1 | 2 = db.offers.some((o) => o.item_id === item.id && o.buyer === who) ? 2 : 1;
  const offer: Offer = { id: newId('o'), item_id: item.id, buyer: who, amount, counter: null, round, status: 'pending', discount_code: null };

  if (item.status === 'sold' || item.status === 'posted') {
    offer.status = 'rejected';
    db.offers.push(offer);
    event('buyer', `${who} offered ${gbp(amount)} for ${the(item)}, but it's already sold.`);
    return offer;
  }

  if (amount >= item.floor_price) {
    const off = item.list_price - amount;
    offer.status = 'accepted';
    if (off > 0) offer.discount_code = fallbackCode || `OFFLOAD-${hashCode(item.id, 4)}-${hashCode(offer.id, 3)}`;
    db.offers.push(offer);
    item.status = 'offer';
    if (off <= 0) event('buyer', `${who} offered the full ${gbp(item.list_price)} for ${the(item)}. Accepted.`, item.list_price);
    else event('buyer', `${who} offered ${gbp(amount)} for ${the(item)}. Accepted, code ${offer.discount_code} takes ${gbp(off)} off.`, amount);
    return offer;
  }

  if (round === 1) {
    offer.status = 'countered';
    offer.counter = counterOffer(amount, item.list_price, item.floor_price);
    db.offers.push(offer);
    item.status = 'offer';
    event('buyer', `${who} offered ${gbp(amount)} for ${the(item)}. Countered at ${gbp(offer.counter)}.`);
    return offer;
  }

  offer.status = 'rejected';
  const othersLive = db.offers.some((o) => o.item_id === item.id && o.buyer !== who && LIVE_OFFER.includes(o.status));
  db.offers.push(offer);
  if (item.status === 'offer' && !othersLive) item.status = 'listed';
  event('buyer', `${who} came back at ${gbp(amount)} for ${the(item)}. That's below what the seller will take, so I said a polite no.`);
  return offer;
}

function recordSale(item: MItem, salePrice: number): Ledger | null {
  if (item.status === 'sold' || item.status === 'posted' || db.ledger.some((l) => l.item_id === item.id)) return null;
  const sale = Math.round(salePrice);
  item.status = 'sold';
  const row: Ledger = { id: newId('l'), item_id: item.id, ...split(sale) };
  db.ledger.push(row);
  const pickup = find('pickups', item.pickup_id);
  const runner = pickup?.runner_name || null; // the runner who collected the pile already holds the item
  db.jobs.push({
    id: newId('j'),
    type: 'post',
    pickup_id: item.pickup_id,
    item_ids: [item.id],
    runner_name: runner,
    address: 'Post to the buyer (address on the Shopify order)',
    pay: POST_JOB_PAY,
    status: runner ? 'accepted' : 'open',
  });
  event('agent', `Sold ${the(item)} for ${gbp(sale)}. ${pickup?.seller_name || 'Seller'} gets ${gbp(row.seller_amount)}.`, sale);
  event('agent', `Booked ${runner || 'a runner'} to post ${the(item)}.`);
  return row;
}

// ---------------------------------------------------------------- live filming (Gemini stand-in)

// A scripted walk through the demo pile, using only the fixed LIVE_PROMPTS. Each prompt stays up for two frames
// (about 5 s at the seller page's one frame every 2.5 s) so there's time to act on it. It ends on "Looks good, you can
// stop" and stays there: it never jumps back to "Show me the label" in the middle of a recording.
// A new recording starts it again: a new pickup, a demo reset, or a gap of more than 12 s between frames.
const FIRST_PROMPT: LivePrompt = LIVE_PROMPTS[0];
const LIVE_SCRIPT: readonly (readonly [LivePrompt, string])[] = [
  ['Show me the label', "denim trucker jacket, Levi's red tab"],
  ['Turn it round', "Levi's trucker, size M"],
  ['Any marks or damage?', 'faded collar, small mark on the left sleeve'],
  ['Got it, next item', "Levi's jacket noted"],
  ['Show the size tag', '90s Nike crewneck, swoosh intact'],
  ['Got it, next item', 'Nike sweatshirt, size L'],
  ['Anything special about it?', 'Lakers 24 jersey, marker on the front number'],
  ['Show me the signature or the change up close', 'looks like a signature across the number'],
  ['Got it, next item', 'Lakers jersey noted'],
  ['What would you want for this one?', 'hand-painted denim jacket, no label'],
  ['Hold it up flat', 'teal wool jumper, cuffs a bit stretched'],
  ['Got it, next item', 'St Michael floral midi dress, belt missing'],
  ['Looks good, you can stop', 'six items: two jackets, a sweatshirt, a jersey, a jumper and a dress'],
];
const PROMPT_HOLD = 2;
const NEW_RECORDING_GAP_MS = 12_000;
let lastFrameAt = 0;

function liveReply(): LiveFrameReply {
  if (liveCalls <= 0) return { prompt: FIRST_PROMPT, notes: '' };
  const [prompt, notes] = LIVE_SCRIPT[Math.min(Math.floor((liveCalls - 1) / PROMPT_HOLD), LIVE_SCRIPT.length - 1)];
  return { prompt, notes };
}

function liveFrame(frame: unknown): LiveFrameReply {
  if (typeof frame === 'string' && frame) {
    const now = Date.now();
    if (lastFrameAt && now - lastFrameAt > NEW_RECORDING_GAP_MS) resetLive();
    lastFrameAt = now;
    liveCalls++;
  }
  return liveReply();
}

// ---------------------------------------------------------------- demo steps (server/src/demo.js)

const alive = (gen: number) => gen === generation;
const runnerNameFor = (p: Pickup | null) => p?.runner_name || cache?.runner_name || 'Sam';

function demoPickup(): Pickup | null {
  for (let i = db.pickups.length - 1; i >= 0; i--) {
    const p = db.pickups[i];
    if (itemsOf(p.id).some((it) => it.meta.demo_key)) return p;
  }
  return null;
}
const demoItems = (pickupId: string) => itemsOf(pickupId).filter((it) => it.meta.demo_key && demoItem(it.meta.demo_key));

function doEstimate(): Pickup {
  const existing = demoPickup();
  if (existing && existing.status === 'estimated') return existing; // a double press doesn't make a second pile
  const c = cache as DemoCache;
  return createPickup({ seller_name: c.seller_name, address: c.address, transcript: c.transcript, estimates: c.items.map(estimateFromCache), demo: true });
}

async function collect(pickupId: string, gen: number) {
  const p = find('pickups', pickupId);
  if (!p || p.status === 'collected' || p.status === 'listed') return;
  const jobId = (pickupJobOf(pickupId) || book(p)).id;
  persist();
  if (find('jobs', jobId)?.status === 'open') {
    await sleep(800);
    if (!alive(gen)) return;
    const j = find('jobs', jobId);
    if (!j) return;
    acceptJob(j, runnerNameFor(find('pickups', pickupId)));
    persist();
  }
  if (find('jobs', jobId)?.status === 'accepted') {
    await sleep(800);
    if (!alive(gen)) return;
    const j = find('jobs', jobId);
    if (!j) return;
    jobDone(j);
    persist();
  }
}

function firstPass(it: MItem) {
  const ci = demoItem(it.meta.demo_key);
  if (!ci) return;
  it.photos = [...(ci.photos || [])];
  if (ci.retake && !it.meta.retake_rounds) {
    it.grade = ci.grade || null;
    it.condition_notes = [...(ci.condition_notes || [])];
    needsPhotos(it, ci.retake.photo_requests, ci.retake.request_summary);
    return;
  }
  finishGrading(it, { grade: ci.grade, condition_notes: ci.condition_notes, special: ci.special, claim_proof: ci.claim_proof }, ci.comps || []);
}

function retake(it: MItem, pickup: Pickup | null) {
  const ci = demoItem(it.meta.demo_key);
  if (!ci) return;
  const r = ci.retake || {};
  const extra = r.photos_after || [];
  if (extra.length) {
    it.photos.push(...extra);
    event('runner', `${runnerNameFor(pickup)} sent ${extra.length === 1 ? 'a new photo' : 'new photos'} of ${the(it)}.`);
  }
  finishGrading(
    it,
    { grade: ci.grade, condition_notes: ci.condition_notes, special: ci.special, claim_proof: r.claim_proof || ci.claim_proof },
    ci.comps || [],
  );
}

// First press: the runner collects and photographs everything (one item needs a retake). Next press: the retake lands.
async function doPhotos(gen: number) {
  const pickupId = (demoPickup() || doEstimate()).id;
  persist();
  await collect(pickupId, gen);
  if (!alive(gen)) return;
  const items = demoItems(pickupId);
  const retakes = items.filter((it) => it.status === 'needs_photos');
  const queue = (retakes.length ? retakes : items.filter((it) => it.status === 'estimated')).map((it) => it.id);
  for (const id of queue) {
    await sleep(900);
    if (!alive(gen)) return;
    const it = find('items', id);
    if (!it) continue;
    if (retakes.length) {
      if (it.status === 'needs_photos') retake(it, find('pickups', pickupId));
    } else if (it.status === 'estimated') firstPass(it);
    persist();
  }
}

function pickTarget(pickupId: string, buyer: string) {
  const open = itemsOf(pickupId).filter(
    (i) => (i.status === 'listed' || i.status === 'offer') && !db.offers.some((o) => o.item_id === i.id && o.buyer === buyer),
  );
  return open.find((i) => i.meta.demo_key === cache?.sale?.item_key) || open[0] || null;
}

// Grok Bot offers below the floor, the agent counters, Grok Bot takes it, the order lands, the money splits.
async function doSale(gen: number) {
  const pickupId = (demoPickup() || doEstimate()).id;
  persist();
  if (demoItems(pickupId).some((i) => i.status === 'estimated' || i.status === 'needs_photos')) {
    await collect(pickupId, gen);
    if (!alive(gen)) return;
    for (const it of demoItems(pickupId).filter((i) => i.status === 'estimated')) firstPass(it);
    for (const it of demoItems(pickupId).filter((i) => i.status === 'needs_photos')) retake(it, find('pickups', pickupId));
    persist();
  }
  if (!alive(gen)) return;
  const pickup = find('pickups', pickupId);
  if (!pickup) return;
  if (pickup.status !== 'listed' || itemsOf(pickupId).some((i) => i.status === 'photographed')) {
    handover(pickup);
    persist();
  }

  const buyer = cache?.sale?.buyer || 'Grok Bot';
  let target = pickTarget(pickupId, buyer);
  for (let t = 0; t < 40 && !target; t++) {
    await sleep(500); // a late listing may still be on its way
    if (!alive(gen)) return;
    target = pickTarget(pickupId, buyer);
  }
  if (!target) {
    event('agent', 'Nothing new to sell yet. Everything listed already has an offer.');
    persist();
    return;
  }
  const itemId = target.id;
  const saleItem = target.meta.demo_key === cache?.sale?.item_key;
  let first = saleItem && cache?.sale?.first_offer ? cache.sale.first_offer : roundPounds(target.floor_price * 0.8);
  if (first >= target.floor_price) first = Math.max(100, target.floor_price - 500);
  // The cached code names the demo's sale item, so only that item gets it.
  const code = saleItem ? cache?.sale?.discount_code || null : null;

  await sleep(800);
  if (!alive(gen)) return;
  let item = find('items', itemId);
  if (!item) return;
  const o1 = makeOffer(item, first, buyer, code);
  persist();
  let agreed = o1.status === 'accepted' ? o1.amount : null;
  if (o1.status === 'countered' && o1.counter != null) {
    await sleep(2500);
    if (!alive(gen)) return;
    item = find('items', itemId);
    if (!item) return;
    const o2 = makeOffer(item, o1.counter, buyer, code);
    persist();
    if (o2.status === 'accepted') agreed = o2.amount;
  }
  if (!agreed) return;

  await sleep(2500); // the order comes in
  if (!alive(gen)) return;
  item = find('items', itemId);
  if (item && item.status !== 'sold' && item.status !== 'posted') {
    recordSale(item, agreed);
    persist();
  }
}

function doReset() {
  generation++;
  busy.clear();
  loadSeed();
  persist();
}

function background(step: string, fn: (gen: number) => Promise<void>) {
  if (busy.has(step)) return; // ignore double presses while a step is running
  busy.add(step);
  const gen = generation;
  track(
    fn(gen).finally(() => {
      if (alive(gen)) busy.delete(step);
    }),
  );
}

function runStep(step: string) {
  if (!['estimate', 'photos', 'sale', 'reset'].includes(step)) {
    throw new ApiError(404, `Unknown demo step "${step}". Use estimate, photos, sale or reset.`);
  }
  if (step === 'reset') return doReset();
  if (!cache?.items?.length) throw new ApiError(503, 'The demo cache is missing (/mock/demo.json).');
  if (step === 'estimate') doEstimate();
  else if (step === 'photos') background('photos', doPhotos);
  else background('sale', doSale);
}

// ---------------------------------------------------------------- loading, saving, syncing tabs

function isState(v: unknown): v is AppState {
  return Boolean(v && typeof v === 'object' && KINDS.every((k) => Array.isArray((v as Record<string, unknown>)[k])));
}

function withMeta(s: AppState | MState): MState {
  const out = clone(s) as MState;
  for (const it of out.items) it.meta = it.meta && typeof it.meta === 'object' ? it.meta : {};
  out.events.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  return out;
}

function loadSeed() {
  const s = withMeta(seed as AppState);
  for (const it of s.items) {
    // The seed's retake has already been asked for once, and its "what would you want" question already asked.
    if (it.status === 'needs_photos') it.meta.retake_rounds = Math.max(1, it.meta.retake_rounds || 0);
    if (it.price_source === 'table' && it.status !== 'estimated') it.meta.asked_price = true;
  }
  db = s;
  resetLive();
  lastTs = s.events.reduce((m, e) => (e.ts > m ? e.ts : m), '');
}

// Any change to the seed or the demo cache throws away saved mock state (it was built from the old files).
const signature = (s: AppState, c: DemoCache | null) => `${hashCode(JSON.stringify(s), 7)}${hashCode(JSON.stringify(c), 7)}`;

function parseSnapshot(text: string | null): Snapshot | null {
  if (!text) return null;
  try {
    const snap = JSON.parse(text) as Snapshot;
    if (!snap || snap.v !== 1 || snap.sig !== seedSig || !isState(snap.state)) return null;
    return snap;
  } catch {
    return null;
  }
}

// The id counter from a snapshot that can't be used any more (older seed or demo cache).
function savedSeq(text: string | null): number {
  try {
    const n = Number((JSON.parse(text || 'null') as { seq?: unknown } | null)?.seq);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function readStorage(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function adopt(snap: Snapshot, fromOtherTab = false) {
  const next = withMeta(snap.state);
  if (fromOtherTab) {
    // Another tab may have saved small copies or placeholders of photos this tab still has in full.
    const keep = (incoming: string, mine: string | undefined) =>
      mine && (incoming === PHOTO_PLACEHOLDER || thumbs.get(mine) === incoming) ? mine : incoming;
    for (const it of next.items) {
      const mine = db.items.find((m) => m.id === it.id);
      if (!mine) continue;
      it.photos = it.photos.map((u, i) => keep(u, mine.photos[i]));
      it.seller_proof = it.seller_proof.map((u, i) => keep(u, mine.seller_proof[i]));
      if (it.claim_proof) it.claim_proof = keep(it.claim_proof, mine.claim_proof ?? undefined);
    }
  }
  db = next;
  seq = Math.max(seq, Number(snap.seq) || 0);
  if (!fromOtherTab) liveCalls = Number(snap.liveCalls) || 0; // filming belongs to the tab doing it
  lastTs = typeof snap.lastTs === 'string' && snap.lastTs > lastTs ? snap.lastTs : lastTs;
}

// When the full state won't fit in localStorage, phone-sized photos are saved as 480px copies (the same inline size the
// backend keeps when its storage is down), or as a grey placeholder until the copy is ready. The 480px copies are well
// under BIG_PHOTO, so copies saved earlier (or brought back by a reload) are never swapped for placeholders.
// If even that doesn't fit, every data URL photo is saved as a placeholder, so the saved state never goes stale.
const BIG_PHOTO = 100_000; // characters of data URL, roughly a 75 KB JPEG
const FULL_SAVE_LIMIT = 4_000_000;
const thumbs = new Map<string, string>();
const isDataPhoto = (v: unknown): v is string => typeof v === 'string' && v.length > 2048 && v.startsWith('data:');
const isBigPhoto = (v: unknown): v is string => isDataPhoto(v) && v.length > BIG_PHOTO;
const shrinkPhotos = (_key: string, v: unknown) => (isBigPhoto(v) ? thumbs.get(v) ?? PHOTO_PLACEHOLDER : v);
const dropPhotos = (_key: string, v: unknown) => (isDataPhoto(v) ? PHOTO_PLACEHOLDER : v);

async function thumbnail(url: string): Promise<string | null> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.6);
}

// Browser only: makes the small copies in the background, then saves again.
function shrinkLater(urls: string[]) {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return;
  const todo = urls.filter((u) => isBigPhoto(u) && !thumbs.has(u));
  if (!todo.length) return;
  track(
    Promise.all(
      todo.map(async (u) => {
        const t = await thumbnail(u).catch(() => null);
        if (t && t.length < u.length) thumbs.set(u, t);
      }),
    ).then(() => persist()),
  );
}

function persist() {
  if (!seed) return;
  let store: Storage | undefined;
  try {
    store = globalThis.localStorage;
  } catch {
    return; // blocked (sandboxed or private mode): this tab keeps working from memory
  }
  if (!store) return;
  const snap: Snapshot = { v: 1, sig: seedSig, seq, liveCalls, lastTs, state: db };
  for (const replacer of [null, shrinkPhotos, dropPhotos]) {
    try {
      const text = replacer ? JSON.stringify(snap, replacer) : JSON.stringify(snap);
      if (!replacer && text.length > FULL_SAVE_LIMIT) continue;
      store.setItem(STORAGE_KEY, text);
      return;
    } catch {
      /* over the quota: try a smaller copy */
    }
  }
}

function listenToOtherTabs() {
  if (listening || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  listening = true;
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY || !seed) return;
    const snap = parseSnapshot(e.newValue);
    if (snap) adopt(snap, true);
  });
}

async function getJson(file: string): Promise<unknown> {
  const base = String(import.meta.env?.BASE_URL || '/').replace(/\/?$/, '/');
  const res = await fetch(`${base}${file}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  return res.json();
}

async function init() {
  const [s, c] = await Promise.all([
    getJson('mock/seed.json').catch(() => null),
    getJson('mock/demo.json').catch(() => null),
  ]);
  if (!isState(s)) throw new ApiError(503, "Couldn't load the demo data (/mock/seed.json). Is it deployed?");
  seed = s;
  const dc = c as DemoCache | null;
  cache = dc && Array.isArray(dc.items) ? dc : null;
  seedSig = signature(s, cache);
  const text = readStorage();
  const snap = parseSnapshot(text);
  if (snap) adopt(snap);
  else {
    loadSeed();
    seq = Math.max(seq, savedSeq(text)); // ids saved on this device (e.g. "my pickup") never get handed out again
  }
  listenToOtherTabs();
}

function ensureReady() {
  ready ||= init().catch((e) => {
    ready = null; // try again on the next call
    throw e;
  });
  return ready;
}

// ---------------------------------------------------------------- routes

interface Route {
  method: 'GET' | 'POST';
  re: RegExp;
  writes: boolean;
  run: (params: string[], body: Body) => unknown;
}

const ROUTES: Route[] = [
  { method: 'GET', re: /^\/api\/state$/, writes: false, run: () => publicState() },
  {
    method: 'POST',
    re: /^\/api\/live\/frame$/,
    writes: false, // saved with the next real change; a frame every couple of seconds shouldn't rewrite storage
    run: (_p, b) => liveFrame(b.frame_b64),
  },
  {
    method: 'POST',
    re: /^\/api\/pickups$/,
    writes: true,
    run: (_p, b) => {
      const frames = strings(b.frames_b64);
      const transcript = String(b.transcript ?? '');
      if (!frames.length && !transcript.trim()) throw new ApiError(400, 'Send at least one frame or some transcript.');
      const estimates: RawEstimate[] = cache?.items.length
        ? cache.items.map(estimateFromCache)
        : [{ label: 'Bag of clothes', type: 'other', brand_tier: 'unknown', seller_story: clip(transcript, 300) || null }];
      return createPickup({ seller_name: b.seller_name, address: b.address, transcript, estimates });
    },
  },
  { method: 'POST', re: /^\/api\/pickups\/([^/]+)\/book$/, writes: true, run: ([id]) => book(need('pickups', id, 'pickup')) },
  {
    method: 'POST',
    re: /^\/api\/jobs\/([^/]+)\/accept$/,
    writes: true,
    run: ([id], b) => acceptJob(need('jobs', id, 'job'), b.runner_name),
  },
  {
    method: 'POST',
    re: /^\/api\/items\/([^/]+)\/photos$/,
    writes: true,
    run: ([id], b) => {
      const item = need('items', id, 'item');
      const photos = strings(b.photos_b64);
      if (!photos.length) throw new ApiError(400, 'Send at least one photo in photos_b64.');
      if (['listed', 'offer', 'sold', 'posted'].includes(item.status)) throw new ApiError(409, 'This one is already listed.');
      return publicItem(photographItem(item, photos));
    },
  },
  {
    method: 'POST',
    re: /^\/api\/items\/([^/]+)\/ask$/,
    writes: true,
    run: ([id], b) => {
      const item = need('items', id, 'item');
      const raw = b.seller_ask;
      const ask = raw === null || raw === undefined || raw === '' ? null : toPence(raw);
      if (raw != null && raw !== '' && !ask) throw new ApiError(400, 'seller_ask must be a whole number of pence, or null to clear it.');
      if (item.status === 'sold' || item.status === 'posted') throw new ApiError(409, "It's already sold.");
      return publicItem(setAsk(item, ask));
    },
  },
  {
    method: 'POST',
    re: /^\/api\/items\/([^/]+)\/proof$/,
    writes: true,
    run: ([id], b) => {
      const item = need('items', id, 'item');
      const photos = strings(b.photos_b64);
      const note = typeof b.note === 'string' ? b.note : '';
      if (!photos.length && !note.trim()) throw new ApiError(400, 'Send a photo or a note.');
      return publicItem(addProof(item, photos, note));
    },
  },
  { method: 'POST', re: /^\/api\/pickups\/([^/]+)\/handover$/, writes: true, run: ([id]) => handover(need('pickups', id, 'pickup')) },
  {
    method: 'POST',
    re: /^\/api\/offers$/,
    writes: true,
    run: (_p, b) => {
      const item = need('items', b.item_id, 'item');
      const pence = toPence(b.amount);
      if (!pence) throw new ApiError(400, 'amount must be a whole number of pence.');
      if (!['listed', 'offer', 'sold', 'posted'].includes(item.status)) throw new ApiError(409, "This one isn't listed yet.");
      return makeOffer(item, pence, b.buyer);
    },
  },
  { method: 'POST', re: /^\/api\/jobs\/([^/]+)\/done$/, writes: true, run: ([id]) => jobDone(need('jobs', id, 'job')) },
  {
    method: 'POST',
    re: /^\/api\/demo\/([^/]+)$/,
    writes: true,
    run: ([step]) => {
      runStep(step);
      return { ok: true };
    },
  },
];

// 150-400 ms, the same sequence every run, so loading states are visible.
const latencyFor = (n: number) => (150 + ((n * 97) % 251)) * timing.latency;

export async function handle(method: string, path: string, body?: unknown): Promise<unknown> {
  const n = ++calls;
  const clean = String(path || '').split(/[?#]/)[0];
  const verb = String(method || '').toUpperCase();
  const route = ROUTES.find((r) => r.method === verb && r.re.test(clean));
  if (timing.latency > 0) await wait(latencyFor(n));
  if (!route) throw new ApiError(404, 'Not found.');
  await ensureReady();

  let params: string[];
  try {
    params = (route.re.exec(clean) || []).slice(1).map(decodeURIComponent);
  } catch {
    throw new ApiError(400, "That address isn't valid.");
  }
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Body;
  const out = route.run(params, b);
  if (route.writes) persist();
  return clone(out);
}

// ---------------------------------------------------------------- test hooks (not used by the app)

// Scale the artificial latency and the demo step pauses (1 = normal, 0 = instant).
export function configureMock(opts: { latency?: number; steps?: number }) {
  if (typeof opts.latency === 'number') timing.latency = Math.max(0, opts.latency);
  if (typeof opts.steps === 'number') timing.steps = Math.max(0, opts.steps);
}

// Resolves once every running demo sequence and delayed listing has finished.
export async function mockIdle(): Promise<void> {
  while (running.size) await Promise.all([...running]);
}

// Drops the in-memory copy so the next call reloads from localStorage (a page reload, in a test).
export function forgetMockMemory() {
  generation++;
  busy.clear();
  ready = null;
  seed = null;
  cache = null;
  db = { pickups: [], items: [], jobs: [], offers: [], ledger: [], events: [] };
  seq = 0;
  resetLive();
  lastTs = '';
}
