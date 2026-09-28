import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compsMedian,
  eventsNewestFirst,
  isOnSale,
  isSold,
  latestOffer,
  latestPickup,
  ledgerFor,
  ledgerOfPickup,
  pickupJob,
  postJobs,
  runnerEarned,
  sellerEarned,
  soldTotal,
} from '../src/lib/selectors.ts';
import type { AppState, Item, Job, Ledger, Pickup } from '../src/types.ts';
import { readJson } from './helpers.ts';

const pickup = (id: string, created_at: string): Pickup => ({
  id,
  seller_name: 'Maya',
  address: '18 Lauriston Road',
  transcript: '',
  estimate_low: 0,
  estimate_high: 0,
  preview: [],
  status: 'listed',
  runner_name: 'Sam',
  created_at,
});

const item = (id: string, pickup_id: string, extra: Partial<Item> = {}): Item => ({
  id,
  pickup_id,
  label: id,
  brand: null,
  type: 'jacket',
  size: null,
  grade: 'B',
  condition_notes: [],
  special: null,
  claim: null,
  claim_proof: null,
  seller_ask: null,
  price_source: 'comps',
  price_confidence: 'high',
  seller_story: null,
  photo_requests: [],
  proof_request: null,
  seller_proof: [],
  photos: [],
  comps: [],
  list_price: 4000,
  floor_price: 2800,
  shopify_url: null,
  status: 'listed',
  ...extra,
});

const job = (id: string, extra: Partial<Job>): Job => ({
  id,
  type: 'pickup',
  pickup_id: 'p1',
  item_ids: [],
  runner_name: 'Sam',
  address: '',
  pay: 0,
  status: 'done',
  ...extra,
});

const ledger = (id: string, item_id: string, sale_price: number): Ledger => {
  const seller_amount = Math.round(sale_price * 0.7);
  return { id, item_id, sale_price, seller_amount, runner_amount: 600, our_amount: sale_price - seller_amount - 600 };
};

function world(): AppState {
  return {
    pickups: [pickup('p1', '2026-09-26T07:00:00.000Z'), pickup('p2', '2026-09-26T09:00:00.000Z'), pickup('p0', '2026-09-26T08:00:00.000Z')],
    items: [
      item('a', 'p1', { status: 'sold' }),
      item('b', 'p1', { status: 'posted' }),
      item('c', 'p1'),
      item('d', 'p2', { status: 'sold' }),
      item('e', 'p2', { status: 'offer' }),
    ],
    jobs: [
      job('j1', { type: 'pickup', pickup_id: 'p1', item_ids: ['a', 'b', 'c'], pay: 1800, status: 'done', runner_name: 'Sam' }),
      job('j2', { type: 'post', pickup_id: 'p1', item_ids: ['a'], pay: 600, status: 'accepted', runner_name: 'Sam' }),
      job('j3', { type: 'post', pickup_id: 'p1', item_ids: ['b'], pay: 600, status: 'done', runner_name: 'Sam' }),
      job('j4', { type: 'pickup', pickup_id: 'p2', item_ids: ['d', 'e'], pay: 1200, status: 'done', runner_name: 'Alex' }),
      job('j5', { type: 'pickup', pickup_id: 'p0', item_ids: [], pay: 3600, status: 'accepted', runner_name: 'Sam' }),
      job('j6', { type: 'post', pickup_id: 'p2', item_ids: ['d'], pay: 600, status: 'done', runner_name: 'Alex' }),
    ],
    offers: [
      { id: 'o1', item_id: 'e', buyer: 'Grok Bot', amount: 2000, counter: 3100, round: 1, status: 'countered', discount_code: null },
      { id: 'o2', item_id: 'e', buyer: 'Grok Bot', amount: 3100, counter: null, round: 2, status: 'accepted', discount_code: 'OFFLOAD-AAAA-BBB' },
    ],
    ledger: [ledger('l1', 'a', 3300), ledger('l2', 'b', 4600), ledger('l3', 'd', 1000)],
    events: [
      { id: 'e1', ts: '2026-09-26T07:00:00.000Z', actor: 'agent', text: 'first', money: null },
      { id: 'e3', ts: '2026-09-26T07:00:00.002Z', actor: 'buyer', text: 'third', money: 100 },
      { id: 'e2', ts: '2026-09-26T07:00:00.001Z', actor: 'runner', text: 'second', money: null },
    ],
  };
}

test('runnerEarned counts done pickup jobs only, never post jobs on top', () => {
  const s = world();
  assert.equal(runnerEarned(s, 'Sam'), 1800); // j1 only: j2/j3 are post jobs (same money), j5 not done yet
  assert.equal(runnerEarned(s, 'Alex'), 1200); // j6 (done post job) is not added
  assert.equal(runnerEarned(s), 3000);
  assert.equal(runnerEarned(s, null), 3000);
  assert.equal(runnerEarned(s, 'Nobody'), 0);
  // marking every post job done changes nothing
  const allPosted = { ...s, jobs: s.jobs.map((j) => (j.type === 'post' ? { ...j, status: 'done' as const } : j)) };
  assert.equal(runnerEarned(allPosted, 'Sam'), 1800);
});

test('sellerEarned and soldTotal sum the ledger, per pickup or overall', () => {
  const s = world();
  assert.equal(sellerEarned(s), 2310 + 3220 + 700);
  assert.equal(sellerEarned(s, 'p1'), 2310 + 3220);
  assert.equal(sellerEarned(s, 'p2'), 700);
  assert.equal(sellerEarned(s, 'nope'), 0);
  assert.equal(soldTotal(s), 3300 + 4600 + 1000);
  assert.equal(soldTotal(s, 'p1'), 7900);
  assert.deepEqual(ledgerOfPickup(s, 'p2').map((l) => l.id), ['l3']);
  assert.equal(ledgerFor(s, 'b')?.sale_price, 4600);
  assert.equal(ledgerFor(s, 'c'), null);
  assert.equal(sellerEarned({ ...s, ledger: [] }), 0);
});

test('latestPickup, pickupJob, postJobs, latestOffer', () => {
  const s = world();
  assert.equal(latestPickup(s)?.id, 'p2');
  assert.equal(latestPickup({ ...s, pickups: [] }), null);
  assert.equal(pickupJob(s, 'p1')?.id, 'j1');
  assert.equal(pickupJob(s, 'zzz'), null);
  assert.deepEqual(postJobs(s).map((j) => j.id), ['j2', 'j3', 'j6']);
  assert.equal(latestOffer(s, 'e')?.id, 'o2');
  assert.equal(latestOffer(s, 'a'), null);
});

test('eventsNewestFirst sorts by time without touching the original', () => {
  const s = world();
  assert.deepEqual(eventsNewestFirst(s).map((e) => e.id), ['e3', 'e2', 'e1']);
  assert.deepEqual(s.events.map((e) => e.id), ['e1', 'e3', 'e2']);
});

test('isOnSale / isSold', () => {
  assert.equal(isOnSale(item('x', 'p', { status: 'listed' })), true);
  assert.equal(isOnSale(item('x', 'p', { status: 'offer' })), true);
  assert.equal(isOnSale(item('x', 'p', { status: 'sold' })), false);
  assert.equal(isSold(item('x', 'p', { status: 'sold' })), true);
  assert.equal(isSold(item('x', 'p', { status: 'posted' })), true);
  assert.equal(isSold(item('x', 'p', { status: 'photographed' })), false);
});

test('compsMedian needs two prices and ignores junk', () => {
  const c = (price: number) => ({ source: 'eBay', title: 't', price, url: 'https://example.com' });
  assert.equal(compsMedian(item('x', 'p', { comps: [] })), null);
  assert.equal(compsMedian(item('x', 'p', { comps: [c(3000)] })), null);
  assert.equal(compsMedian(item('x', 'p', { comps: [c(3000), c(4000)] })), 3500);
  assert.equal(compsMedian(item('x', 'p', { comps: [c(4900), c(4200), c(4500), c(5500), c(5200)] })), 4900);
  assert.equal(compsMedian(item('x', 'p', { comps: [c(3000), c(0), c(Number.NaN), c(4001)] })), 3501);
});

test('selectors on the real seed: earnings are consistent with the ledger', async () => {
  const s = await readJson<AppState>('public/mock/seed.json');
  const pay = s.jobs.filter((j) => j.type === 'pickup' && j.status === 'done').reduce((n, j) => n + j.pay, 0);
  assert.equal(runnerEarned(s), pay);
  assert.equal(sellerEarned(s), s.ledger.reduce((n, l) => n + l.seller_amount, 0));
  for (const l of s.ledger) assert.equal(l.seller_amount + l.runner_amount + l.our_amount, l.sale_price, l.id);
});
