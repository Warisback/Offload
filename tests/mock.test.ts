// The in-browser mock backend, end to end, checked against the backend's own pricing module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, fetched, photo, readJson, storage, useStorage } from './helpers.ts';
import { LIVE_PROMPTS, type AppState, type Item, type Job, type LiveFrameReply, type Offer, type Pickup } from '../src/types.ts';
import { runnerEarned, sellerEarned } from '../src/lib/selectors.ts';
import * as pricingJs from '../server/src/pricing.js';

// The backend's own pricing module (plain JS), so the mock is checked against the real rule, not a copy of it.
interface PriceArgs {
  type: string;
  brand_tier: string;
  grade?: string | null;
  special?: string | null;
  seller_ask?: number | null;
  comps?: { price: number }[];
}
const pricing = pricingJs as unknown as {
  priceItem(a: PriceArgs): { list_price: number; floor_price: number; price_source: string; price_confidence: string };
  previewRange(a: PriceArgs): { low: number; high: number };
  counterOffer(a: { amount: number; list_price: number; floor_price: number }): number;
  split(sale: number): { sale_price: number; seller_amount: number; runner_amount: number; our_amount: number };
};

// helpers.ts registered the import.meta.env hook, so config.ts can load now.
const mock = await import('../src/lib/mock.ts');
mock.configureMock({ latency: 0, steps: 0 });

interface CacheItem {
  key: string;
  label: string;
  type: string;
  brand_tier: string;
  seller_ask: number | null;
  grade: 'A' | 'B' | 'C' | 'D';
  condition_notes: string[];
  photos: string[];
  claim: string | null;
  claim_proof: string | null;
  retake: { photo_requests: string[]; request_summary: string; photos_after: string[]; claim_proof: string } | null;
  comps: { price: number }[];
}
interface DemoCache {
  seller_name: string;
  address: string;
  runner_name: string;
  items: CacheItem[];
  sale: { item_key: string; buyer: string; first_offer: number; discount_code: string };
}

const demo = await readJson<DemoCache>('tests/fixtures/demo.json'); // frozen: the live demo pile changes
const seed = await readJson<AppState>('public/mock/seed.json');

const call = <T>(method: string, path: string, body?: unknown) => mock.handle(method, path, body) as Promise<T>;
const state = () => call<AppState>('GET', '/api/state');
const post = <T>(path: string, body: unknown = {}) => call<T>('POST', path, body);

async function reset() {
  await mock.mockIdle();
  await post('/api/demo/reset');
  await mock.mockIdle();
}

async function rejectsWith(p: Promise<unknown>, status: number, message?: RegExp) {
  await assert.rejects(p, (e: unknown) => {
    const err = e as { name?: string; status?: number; message?: string };
    assert.equal(err.name, 'ApiError');
    assert.equal(err.status, status);
    if (message) assert.match(String(err.message), message);
    return true;
  });
}

const eventTexts = (s: AppState) => s.events.map((e) => e.text);
const countText = (s: AppState, text: string) => s.events.filter((e) => e.text === text).length;
const itemsOf = (s: AppState, pickupId: string) => s.items.filter((i) => i.pickup_id === pickupId);
const byKey = (items: Item[], key: string) => items[demo.items.findIndex((ci) => ci.key === key)];
const ci = (key: string) => demo.items.find((c) => c.key === key) as CacheItem;
const MAYA = { seller_name: 'Maya', address: '18 Lauriston Road, Hackney, London E9 7HA' };
const KEY = 'offload.mock.state';

test('loads /mock/seed.json and /mock/demo.json on first use and serves the seed', async () => {
  const s = await state();
  assert.ok(fetched.includes('mock/seed.json'));
  assert.ok(fetched.includes('mock/demo.json'));
  assert.equal(s.pickups.length, seed.pickups.length);
  assert.equal(s.items.length, seed.items.length);
  for (const it of s.items) assert.equal('meta' in it, false, 'meta never leaks to the UI');
});

test('returned data is a copy: the UI cannot change the mock by mutating it', async () => {
  await reset();
  const a = await state();
  a.items[0].label = 'changed';
  a.events.length = 0;
  const b = await state();
  assert.notEqual(b.items[0].label, 'changed');
  assert.equal(b.events.length, seed.events.length);
});

test('unknown routes are 404, bad input is 400', async () => {
  await reset();
  await rejectsWith(call('GET', '/api/nope'), 404, /Not found/);
  await rejectsWith(call('POST', '/api/state'), 404);
  await rejectsWith(call('GET', '/api/offers'), 404);
  await rejectsWith(post('/api/pickups/nope/book'), 404, /No pickup with id nope/);
  await rejectsWith(post('/api/jobs/nope/done'), 404, /No job/);
  await rejectsWith(post('/api/items/nope/photos', { photos_b64: [photo(1)] }), 404, /No item/);
  await rejectsWith(post('/api/demo/dance'), 404, /Unknown demo step/);
  await rejectsWith(post('/api/pickups', { seller_name: 'Maya', frames_b64: [], transcript: '   ' }), 400);
  const gigTee = seed.items.find((i) => i.status === 'needs_photos') as Item;
  await rejectsWith(post(`/api/items/${gigTee.id}/photos`, { photos_b64: [] }), 400);
  await rejectsWith(post(`/api/items/${gigTee.id}/photos`, { photos_b64: ['', 42] }), 400);
  await rejectsWith(post(`/api/items/${gigTee.id}/ask`, { seller_ask: 'abc' }), 400);
  await rejectsWith(post(`/api/items/${gigTee.id}/ask`, { seller_ask: -500 }), 400);
  await rejectsWith(post(`/api/items/${gigTee.id}/proof`, { photos_b64: [], note: ' ' }), 400);
  await rejectsWith(post('/api/offers', { item_id: gigTee.id, amount: 1000, buyer: 'Ava' }), 409, /isn't listed yet/);
  const listed = seed.items.find((i) => i.status === 'listed') as Item;
  await rejectsWith(post('/api/offers', { item_id: listed.id, amount: 'lots', buyer: 'Ava' }), 400);
  await rejectsWith(post('/api/offers', { item_id: listed.id, amount: 0, buyer: 'Ava' }), 400);
  await rejectsWith(post('/api/offers', { item_id: 'nope', amount: 1000, buyer: 'Ava' }), 404);
  await rejectsWith(post(`/api/items/${listed.id}/photos`, { photos_b64: [photo(1)] }), 409, /already listed/);
  // nothing above changed the state
  assert.deepEqual((await state()).events.length, seed.events.length);
});

test('full flow: estimate, book, accept, collect, photos with a retake, handover, offers, sale, split, posting', async () => {
  await reset();

  // --- estimate
  const created = await post<Pickup>('/api/pickups', { ...MAYA, frames_b64: [photo(1), photo(2)], transcript: 'Everything from the wardrobe clear-out.' });
  assert.match(created.id, /^p_m\d{4}$/);
  assert.equal(created.status, 'estimated');
  assert.equal(created.seller_name, 'Maya');
  assert.equal(created.address, MAYA.address);
  assert.equal(created.transcript, 'Everything from the wardrobe clear-out.');
  assert.equal(created.runner_name, null);

  let s = await state();
  const items = itemsOf(s, created.id);
  assert.equal(items.length, demo.items.length);
  demo.items.forEach((c, i) => {
    const it = items[i];
    assert.match(it.id, /^i_m\d{4}$/);
    assert.equal(it.label, c.label);
    assert.equal(it.status, 'estimated');
    assert.equal(it.grade, null);
    assert.deepEqual(it.photos, []);
    // the backend's own pricing rule, before grading
    const p = pricing.priceItem({ type: c.type, brand_tier: c.brand_tier, grade: null, special: null, seller_ask: c.seller_ask, comps: c.comps });
    assert.equal(it.list_price, p.list_price, `${c.key} list`);
    assert.equal(it.floor_price, p.floor_price, `${c.key} floor`);
    assert.equal(it.price_source, p.price_source, `${c.key} source`);
    assert.equal(it.price_confidence, p.price_confidence, `${c.key} confidence`);
    const r = pricing.previewRange({ type: c.type, brand_tier: c.brand_tier, special: null, seller_ask: c.seller_ask, comps: c.comps });
    assert.deepEqual(created.preview[i], { label: c.label, low: r.low, high: r.high });
  });
  assert.equal(created.estimate_low, created.preview.reduce((n, l) => n + l.low, 0));
  assert.equal(created.estimate_high, created.preview.reduce((n, l) => n + l.high, 0));
  const spotted = s.events.filter((e) => e.text.startsWith('Spotted 6 items.')).at(-1); // the seed has one too
  assert.ok(spotted);
  assert.equal(spotted.text, `Spotted 6 items. Expect £${created.estimate_low / 100} to £${created.estimate_high / 100}.`);
  assert.equal(spotted.actor, 'agent');
  assert.equal(spotted.money, created.estimate_high);
  assert.ok(eventTexts(s).includes("Noted you want £80 for the hand-painted denim jacket."));
  assert.ok(eventTexts(s).includes('Asked the seller for proof of the signature.'));
  assert.ok(eventTexts(s).includes('Asked the seller for proof of the painted lettering.'));

  // --- book (twice: same job)
  const job = await post<Job>(`/api/pickups/${created.id}/book`);
  const again = await post<Job>(`/api/pickups/${created.id}/book`);
  assert.equal(again.id, job.id);
  assert.equal(job.type, 'pickup');
  assert.equal(job.status, 'open');
  assert.equal(job.pay, 600 * items.length);
  assert.deepEqual(job.item_ids, items.map((i) => i.id));
  assert.equal(job.address, MAYA.address);
  s = await state();
  assert.equal(s.jobs.filter((j) => j.pickup_id === created.id).length, 1);
  assert.equal(s.pickups.find((p) => p.id === created.id)?.status, 'booked');
  assert.equal(countText(s, 'Runner booked for pickup.'), countText({ ...seed }, 'Runner booked for pickup.') + 1);

  // --- accept (a second runner can't steal it)
  const accepted = await post<Job>(`/api/jobs/${job.id}/accept`, { runner_name: '  Sam  ' });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.runner_name, 'Sam');
  const stolen = await post<Job>(`/api/jobs/${job.id}/accept`, { runner_name: 'Alex' });
  assert.equal(stolen.runner_name, 'Sam');
  s = await state();
  assert.equal(s.pickups.find((p) => p.id === created.id)?.runner_name, 'Sam');
  assert.ok(eventTexts(s).includes('Sam accepted the pickup at 18 Lauriston Road.'));

  // --- collected (twice: no-op)
  const done = await post<Job>(`/api/jobs/${job.id}/done`);
  assert.equal(done.status, 'done');
  const before = (await state()).events.length;
  await post<Job>(`/api/jobs/${job.id}/done`);
  s = await state();
  assert.equal(s.events.length, before);
  assert.equal(s.pickups.find((p) => p.id === created.id)?.status, 'collected');
  assert.equal(countText(s, 'Sam collected 6 items from Maya.'), 1);

  // --- photos: front, back, label, (claim close-up last)
  const uploads = new Map<string, string[]>();
  let n = 10;
  for (const it of items) {
    const c = ci(demo.items[items.indexOf(it)].key);
    const shots = [photo(n++), photo(n++), photo(n++)];
    if (c.claim) shots.push(photo(n++));
    uploads.set(it.id, shots);
    const out = await post<Item>(`/api/items/${it.id}/photos`, { photos_b64: shots });
    assert.deepEqual(out.photos, shots, 'photos are stored as the uploaded data URLs');
    if (c.retake) {
      assert.equal(out.status, 'needs_photos', `${c.key} needs a retake`);
      assert.deepEqual(out.photo_requests, c.retake.photo_requests);
      assert.equal(out.claim_proof, null);
    } else {
      assert.equal(out.status, 'photographed', `${c.key} photographed`);
      assert.equal(out.grade, c.grade);
      assert.deepEqual(out.condition_notes, c.condition_notes);
      assert.deepEqual(out.photo_requests, []);
      assert.deepEqual(out.comps.map((x) => x.price), c.comps.map((x) => x.price));
      const p = pricing.priceItem({ type: c.type, brand_tier: c.brand_tier, grade: c.grade, special: null, seller_ask: c.seller_ask, comps: c.comps });
      assert.equal(out.list_price, p.list_price, `${c.key} graded list`);
      assert.equal(out.floor_price, p.floor_price, `${c.key} graded floor`);
      assert.equal(out.price_source, p.price_source);
      if (c.claim) assert.equal(out.claim_proof, shots.at(-1), 'the close-up (last photo) becomes claim_proof');
    }
  }
  const kobe = byKey(items, 'kobe-jersey');
  const levis = byKey(items, 'levis-trucker');
  const nike = byKey(items, 'nike-crewneck');
  s = await state();
  assert.ok(eventTexts(s).includes('Asked the runner for a clearer shot of the signature.'));
  assert.ok(eventTexts(s).includes('Graded the hand-painted denim jacket B. Listing it at your £80.'));
  assert.ok(eventTexts(s).some((t) => /^Graded the teal wool jumper B\. No price matches found, priced from our table at £\d+\.$/.test(t)));
  assert.ok(eventTexts(s).includes("Couldn't find anything like the teal wool jumper online. What would you want for it?"));
  assert.ok(eventTexts(s).some((t) => /^Graded the Levi's denim trucker jacket B\. Similar ones sell around £49, so I'll list it at £\d+\.$/.test(t)));

  // --- handover while one item still needs a photo: it's held back, the rest go live
  const listedPickup = await post<Pickup>(`/api/pickups/${created.id}/handover`);
  assert.equal(listedPickup.status, 'listed');
  s = await state();
  for (const it of itemsOf(s, created.id)) {
    if (it.id === kobe.id) assert.equal(it.status, 'needs_photos');
    else {
      assert.equal(it.status, 'listed', it.label);
      assert.equal(it.shopify_url, null);
    }
  }
  assert.ok(eventTexts(s).includes('Holding back the adidas Lakers Bryant 24 jersey until the runner sends a clearer shot of the signature.'));
  assert.ok(eventTexts(s).includes('Similar ones sell around £30. Listed at your £80 anyway, I\'ll tell you if it\'s slow.'));

  // --- the retake: photographed straight away, then it joins the live listing
  const fixed = await post<Item>(`/api/items/${kobe.id}/photos`, { photos_b64: [photo(99)] });
  assert.equal(fixed.status, 'photographed');
  assert.deepEqual(fixed.photo_requests, []);
  assert.equal(fixed.claim_proof, photo(99));
  assert.equal(fixed.grade, 'B');
  assert.deepEqual(fixed.photos, [...(uploads.get(kobe.id) as string[]), photo(99)]);
  await mock.mockIdle();
  s = await state();
  assert.equal(s.items.find((i) => i.id === kobe.id)?.status, 'listed');
  assert.ok(eventTexts(s).some((t) => t.startsWith('Listed the adidas Lakers Bryant 24 jersey at £')));
  await rejectsWith(post(`/api/items/${kobe.id}/photos`, { photos_b64: [photo(100)] }), 409);

  // --- offer below floor: countered at the midpoint in whole pounds; taking the counter is accepted with a code
  const lv = s.items.find((i) => i.id === levis.id) as Item;
  const o1 = await post<Offer>('/api/offers', { item_id: lv.id, amount: 2000, buyer: 'Ava' });
  assert.match(o1.id, /^o_m\d{4}$/);
  assert.equal(o1.status, 'countered');
  assert.equal(o1.round, 1);
  assert.equal(o1.counter, pricing.counterOffer({ amount: 2000, list_price: lv.list_price, floor_price: lv.floor_price }));
  assert.equal((o1.counter as number) % 100, 0);
  assert.ok((o1.counter as number) >= lv.floor_price && (o1.counter as number) <= lv.list_price);
  const o2 = await post<Offer>('/api/offers', { item_id: lv.id, amount: o1.counter, buyer: 'Ava' });
  assert.equal(o2.status, 'accepted');
  assert.equal(o2.round, 2);
  assert.match(o2.discount_code as string, /^OFFLOAD-[0-9A-Z]{4}-[0-9A-Z]{3}$/);
  s = await state();
  assert.equal(s.items.find((i) => i.id === lv.id)?.status, 'offer');
  assert.ok(eventTexts(s).includes(`Ava offered £20 for the Levi's denim trucker jacket. Countered at £${(o1.counter as number) / 100}.`));

  // --- round 2 below floor: a polite no, and the item goes back to listed; the counter never goes below floor
  const nk = s.items.find((i) => i.id === nike.id) as Item;
  const n1 = await post<Offer>('/api/offers', { item_id: nk.id, amount: 100, buyer: 'Ben' });
  assert.equal(n1.status, 'countered');
  assert.equal(n1.counter, Math.max(nk.floor_price, pricing.counterOffer({ amount: 100, list_price: nk.list_price, floor_price: nk.floor_price })));
  assert.ok((n1.counter as number) >= nk.floor_price);
  const n2 = await post<Offer>('/api/offers', { item_id: nk.id, amount: 1500, buyer: 'Ben' });
  assert.equal(n2.status, 'rejected');
  assert.equal(n2.round, 2);
  const n3 = await post<Offer>('/api/offers', { item_id: nk.id, amount: 1500, buyer: 'Ben' });
  assert.equal(n3.round, 2, 'never a round 3');
  s = await state();
  assert.equal(s.items.find((i) => i.id === nk.id)?.status, 'listed');

  // --- the demo sale: Grok Bot offers low, gets countered, takes it, the order lands. Double press is ignored.
  const ledgerBefore = s.ledger.length;
  await post('/api/demo/sale');
  await post('/api/demo/sale');
  await mock.mockIdle();
  s = await state();
  const sold = s.items.find((i) => i.id === lv.id) as Item;
  assert.equal(sold.status, 'sold');
  const grok = s.offers.filter((o) => o.item_id === lv.id && o.buyer === demo.sale.buyer);
  assert.equal(grok.length, 2);
  assert.equal(grok[0].amount, demo.sale.first_offer);
  assert.equal(grok[0].status, 'countered');
  assert.equal(grok[1].amount, grok[0].counter);
  assert.equal(grok[1].status, 'accepted');
  assert.equal(grok[1].discount_code, demo.sale.discount_code, 'the demo sale uses the cached code');
  const salePrice = grok[1].amount;
  assert.equal(s.ledger.length, ledgerBefore + 1, 'one ledger row, not two');
  const row = s.ledger.find((l) => l.item_id === lv.id);
  assert.ok(row);
  assert.match(row.id, /^l_m\d{4}$/);
  assert.deepEqual(
    { sale: row.sale_price, seller: row.seller_amount, runner: row.runner_amount, ours: row.our_amount },
    { sale: salePrice, seller: Math.round(salePrice * 0.7), runner: 600, ours: salePrice - Math.round(salePrice * 0.7) - 600 },
  );
  const { sale_price, seller_amount, runner_amount, our_amount } = pricing.split(salePrice);
  assert.deepEqual([row.sale_price, row.seller_amount, row.runner_amount, row.our_amount], [sale_price, seller_amount, runner_amount, our_amount]);
  const postJob = s.jobs.find((j) => j.type === 'post' && j.item_ids[0] === lv.id) as Job;
  assert.ok(postJob);
  assert.equal(postJob.pay, 600);
  assert.equal(postJob.runner_name, 'Sam');
  assert.equal(postJob.status, 'accepted');
  const soldEvent = s.events.find((e) => e.text === `Sold the Levi's denim trucker jacket for £${salePrice / 100}. Maya gets £${(Math.round(salePrice * 0.7) / 100).toFixed(2).replace(/\.00$/, '')}.`);
  assert.ok(soldEvent, 'sale event');
  assert.equal(soldEvent.money, salePrice);
  assert.ok(eventTexts(s).includes("Booked Sam to post the Levi's denim trucker jacket."));
  assert.equal(sellerEarned(s, created.id), row.seller_amount);

  // --- offers on a sold item are rejected and change nothing
  const late = await post<Offer>('/api/offers', { item_id: lv.id, amount: 9000, buyer: 'Cara' });
  assert.equal(late.status, 'rejected');
  assert.equal(late.discount_code, null);
  s = await state();
  assert.equal(s.items.find((i) => i.id === lv.id)?.status, 'sold');
  assert.equal(s.ledger.filter((l) => l.item_id === lv.id).length, 1);
  assert.ok(eventTexts(s).includes("Cara offered £90 for the Levi's denim trucker jacket, but it's already sold."));
  await rejectsWith(post(`/api/items/${lv.id}/ask`, { seller_ask: 5000 }), 409);

  // --- posting it: the runner taps "Posted" (twice: no-op); runner earnings don't double count
  const earnedBefore = runnerEarned(s, 'Sam');
  const posted = await post<Job>(`/api/jobs/${postJob.id}/done`);
  assert.equal(posted.status, 'done');
  const evCount = (await state()).events.length;
  await post<Job>(`/api/jobs/${postJob.id}/done`);
  s = await state();
  assert.equal(s.events.length, evCount);
  assert.equal(s.items.find((i) => i.id === lv.id)?.status, 'posted');
  assert.equal(countText(s, "Sam posted the Levi's denim trucker jacket. It's on its way to the buyer."), 1);
  assert.equal(runnerEarned(s, 'Sam'), earnedBefore, 'post jobs never add to runner earnings');
  const pickupPay = s.jobs.filter((j) => j.type === 'pickup' && j.status === 'done' && j.runner_name === 'Sam').reduce((t, j) => t + j.pay, 0);
  assert.equal(runnerEarned(s, 'Sam'), pickupPay);

  // --- ids are unique across everything
  const ids = [...s.pickups, ...s.items, ...s.jobs, ...s.offers, ...s.ledger, ...s.events].map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  // events stay in time order
  const ts = s.events.map((e) => e.ts);
  assert.deepEqual(ts, [...ts].sort());
});

test('seller price and proof', async () => {
  await reset();
  const p = await post<Pickup>('/api/pickups', { ...MAYA, frames_b64: [photo(1)], transcript: '' });
  const items = itemsOf(await state(), p.id);
  const nike = byKey(items, 'nike-crewneck');
  const withAsk = await post<Item>(`/api/items/${nike.id}/ask`, { seller_ask: 4500 });
  assert.equal(withAsk.seller_ask, 4500);
  assert.equal(withAsk.list_price, 4500);
  assert.equal(withAsk.floor_price, 3600);
  assert.equal(withAsk.price_source, 'seller');
  let s = await state();
  assert.ok(eventTexts(s).includes('Maya set £45 for the 90s Nike sweatshirt.'));
  const line = s.pickups.find((x) => x.id === p.id)?.preview[items.indexOf(nike)];
  assert.deepEqual(line, { label: nike.label, low: 3600, high: 4500 });

  const cleared = await post<Item>(`/api/items/${nike.id}/ask`, { seller_ask: null });
  assert.equal(cleared.seller_ask, null);
  assert.equal(cleared.price_source, 'comps');
  s = await state();
  assert.ok(eventTexts(s).includes('Maya took their price off the 90s Nike sweatshirt.'));

  const kobe = byKey(items, 'kobe-jersey');
  assert.ok(kobe.proof_request);
  const proved = await post<Item>(`/api/items/${kobe.id}/proof`, { photos_b64: [photo(5)], note: 'My uncle at the signing' });
  assert.deepEqual(proved.seller_proof, [photo(5)]);
  assert.equal(proved.proof_request, null);
  s = await state();
  assert.ok(eventTexts(s).includes('Maya sent proof for the adidas Lakers Bryant 24 jersey.'));
});

test('demo keys: estimate (double press = one pile), photos with a retake on the second press, then the sale', async () => {
  await reset();
  await post('/api/demo/estimate');
  await post('/api/demo/estimate');
  let s = await state();
  assert.equal(s.pickups.length, seed.pickups.length + 1, 'double press makes one pile');
  const pile = s.pickups.find((x) => !seed.pickups.some((sp) => sp.id === x.id)) as Pickup;
  assert.equal(pile.seller_name, demo.seller_name);
  assert.equal(pile.status, 'estimated');

  await post('/api/demo/photos');
  await mock.mockIdle();
  s = await state();
  let items = itemsOf(s, pile.id);
  const job = s.jobs.find((j) => j.type === 'pickup' && j.pickup_id === pile.id) as Job;
  assert.equal(job.status, 'done');
  assert.equal(job.runner_name, demo.runner_name);
  assert.equal(s.pickups.find((x) => x.id === pile.id)?.status, 'collected');
  const kobeCache = ci('kobe-jersey');
  for (const it of items) {
    const c = demo.items[items.indexOf(it)];
    assert.deepEqual(it.photos, c.photos);
    assert.equal(it.status, c.retake ? 'needs_photos' : 'photographed', c.key);
  }

  await post('/api/demo/photos');
  await mock.mockIdle();
  s = await state();
  items = itemsOf(s, pile.id);
  const kobe = byKey(items, 'kobe-jersey');
  assert.equal(kobe.status, 'photographed');
  assert.deepEqual(kobe.photos, [...kobeCache.photos, ...(kobeCache.retake?.photos_after ?? [])]);
  assert.equal(kobe.claim_proof, kobeCache.retake?.claim_proof);
  assert.ok(eventTexts(s).includes(`${demo.runner_name} sent new photos of the adidas Lakers Bryant 24 jersey.`));

  await post('/api/demo/sale');
  await mock.mockIdle();
  s = await state();
  assert.equal(s.pickups.find((x) => x.id === pile.id)?.status, 'listed');
  const target = byKey(itemsOf(s, pile.id), demo.sale.item_key);
  assert.equal(target.status, 'sold');
  assert.equal(s.ledger.filter((l) => l.item_id === target.id).length, 1);

  // another press sells the next item, never the same one twice
  await post('/api/demo/sale');
  await mock.mockIdle();
  s = await state();
  const soldIds = s.ledger.map((l) => l.item_id);
  assert.equal(new Set(soldIds).size, soldIds.length);
  assert.equal(itemsOf(s, pile.id).filter((i) => i.status === 'sold').length, 2);
});

test('demo sale from a fresh reset fast-forwards the whole story', async () => {
  await reset();
  await post('/api/demo/sale');
  await mock.mockIdle();
  const s = await state();
  const pile = s.pickups.find((x) => !seed.pickups.some((sp) => sp.id === x.id)) as Pickup;
  assert.ok(pile);
  assert.equal(pile.status, 'listed');
  assert.equal(pile.runner_name, demo.runner_name);
  const items = itemsOf(s, pile.id);
  assert.equal(byKey(items, demo.sale.item_key).status, 'sold');
  for (const it of items) assert.ok(['listed', 'offer', 'sold'].includes(it.status), `${it.label} is ${it.status}`);
  assert.equal(s.ledger.length, seed.ledger.length + 1);
});

test('reset goes back to the seed and stops sequences that are still running', async () => {
  await reset();
  await post('/api/demo/sale'); // starts a background sequence
  await post('/api/demo/reset');
  await mock.mockIdle();
  const s = await state();
  const expected = { ...seed, events: [...seed.events].sort((a, b) => a.ts.localeCompare(b.ts)) };
  assert.deepEqual(s, expected);
});

test('live frames walk the fixed prompts in order, hold each for two frames, and end on "you can stop"', async () => {
  await reset();
  const idle = await post<LiveFrameReply>('/api/live/frame', { frame_b64: '', transcript: '' });
  assert.deepEqual(idle, { prompt: 'Show me the label', notes: '' });
  const run = async (frames: number) => {
    const out: LiveFrameReply[] = [];
    for (let i = 0; i < frames; i++) out.push(await post<LiveFrameReply>('/api/live/frame', { frame_b64: photo(i), transcript: 'this one is a denim jacket' }));
    return out;
  };
  const a = await run(40);
  for (const r of a) {
    assert.ok((LIVE_PROMPTS as readonly string[]).includes(r.prompt), r.prompt);
    assert.equal(typeof r.notes, 'string');
    assert.ok(r.notes.length > 0);
  }
  assert.equal(a[0].prompt, 'Show me the label');
  assert.equal(a[1].prompt, a[0].prompt, 'each prompt stays up for two frames');
  assert.equal(a[2].prompt, 'Turn it round');
  assert.equal(new Set(a.map((r) => r.prompt)).size, LIVE_PROMPTS.length, 'every prompt shows up');
  const stop = a.findIndex((r) => r.prompt === 'Looks good, you can stop');
  assert.ok(stop > 0);
  assert.ok(a.slice(stop).every((r) => r.prompt === 'Looks good, you can stop'), 'never starts over in the middle of a recording');

  await post('/api/demo/reset');
  assert.deepEqual(await run(40), a, 'the same after a reset');

  await post('/api/pickups', { ...MAYA, frames_b64: [photo(1)], transcript: 'hi' });
  assert.equal((await run(1))[0].prompt, 'Show me the label', 'a new pickup starts it again');

  await run(8);
  const realNow = Date.now;
  Date.now = () => realNow() + 60_000; // the next frame comes a minute later: a new recording
  try {
    assert.equal((await run(1))[0].prompt, 'Show me the label', 'a new recording starts it again');
  } finally {
    Date.now = realNow;
  }
});

test('state is saved to localStorage and survives a reload', async () => {
  await reset();
  const p = await post<Pickup>('/api/pickups', { ...MAYA, frames_b64: [photo(1)], transcript: 'hi' });
  const job = await post<Job>(`/api/pickups/${p.id}/book`);
  const saved = JSON.parse(storage.getItem('offload.mock.state') as string);
  assert.equal(saved.v, 1);
  assert.ok(saved.state.pickups.some((x: Pickup) => x.id === p.id));
  assert.ok(saved.state.items.every((i: { meta?: unknown }) => typeof i.meta === 'object'), 'internal meta is persisted');
  const beforeReload = await state();

  mock.forgetMockMemory(); // like reloading the page
  const afterReload = await state();
  assert.deepEqual(afterReload, beforeReload);
  // the id counter carries on, so nothing collides after a reload
  const again = await post<Job>(`/api/pickups/${p.id}/book`);
  assert.equal(again.id, job.id);
  const p2 = await post<Pickup>('/api/pickups', { ...MAYA, frames_b64: [photo(2)], transcript: 'again' });
  const ids = (await state()).items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.notEqual(p2.id, p.id);

  // a corrupt or foreign snapshot is ignored, not fatal
  storage.setItem('offload.mock.state', '{not json');
  mock.forgetMockMemory();
  assert.equal((await state()).pickups.length, seed.pickups.length);

  // a snapshot from an older seed is thrown away, but its id counter carries on so saved ids never come back
  storage.setItem(KEY, JSON.stringify({ v: 1, sig: 'an-older-seed', seq: 500, liveCalls: 0, lastTs: '', state: seed }));
  mock.forgetMockMemory();
  assert.equal((await state()).pickups.length, seed.pickups.length);
  const p3 = await post<Pickup>('/api/pickups', { ...MAYA, frames_b64: [photo(3)], transcript: 'third' });
  assert.ok(Number(p3.id.slice(3)) > 500, p3.id);
});

test('photos too big for localStorage are saved small, small copies are kept, the tab keeps the originals', async () => {
  await reset();
  const p = await post<Pickup>('/api/pickups', { ...MAYA, frames_b64: [photo(1)], transcript: 'hi' });
  const items = itemsOf(await state(), p.id);
  const big = `data:image/jpeg;base64,${'B'.repeat(900_000)}`;
  const small = `data:image/jpeg;base64,${'S'.repeat(50_000)}`; // the size of a 480px copy
  await post(`/api/items/${items[5].id}/photos`, { photos_b64: [small, photo(1)] });
  for (const it of items.slice(0, 5)) await post(`/api/items/${it.id}/photos`, { photos_b64: [big, big] });
  const saved = storage.getItem(KEY) as string;
  assert.ok(saved.length < 4_000_000, 'snapshot shrunk');
  const snap = JSON.parse(saved) as { state: AppState };
  assert.ok(snap.state.items.find((i) => i.id === items[0].id)?.photos.every((u) => u.length < 1000), 'big photos saved small');
  assert.equal(snap.state.items.find((i) => i.id === items[5].id)?.photos[0], small, 'small copies are kept as they are');
  const inMemory = await state();
  assert.equal(inMemory.items.find((i) => i.id === items[0].id)?.photos[0], big);
});

test('storage full: photos saved as placeholders so the saved state stays current; other tabs are picked up', async () => {
  await reset();
  const win = new EventTarget();
  const limited = new MemoryStorage(250_000);
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });
  useStorage(limited);
  try {
    mock.forgetMockMemory(); // a reload, with a window to listen on and an empty store
    const p = await post<Pickup>('/api/pickups', { ...MAYA, frames_b64: [photo(1)], transcript: 'hi' });
    const levis = byKey(itemsOf(await state(), p.id), 'levis-trucker');
    // too many to fit together, each one under the size that gets shrunk
    const shots = [1, 2, 3, 4, 5].map((n) => `data:image/jpeg;base64,${String(n).repeat(60_000)}`);
    const out = await post<Item>(`/api/items/${levis.id}/photos`, { photos_b64: shots });
    assert.equal(out.status, 'photographed');
    const saved = JSON.parse(limited.getItem(KEY) as string) as { state: AppState };
    const savedItem = saved.state.items.find((i) => i.id === levis.id) as Item;
    assert.equal(savedItem.status, 'photographed', 'the latest state was saved, not an old one');
    assert.ok(savedItem.photos.every((u) => u.startsWith('data:image/svg+xml') && u.length < 500), 'photos saved as placeholders');
    assert.deepEqual((await state()).items.find((i) => i.id === levis.id)?.photos, shots, 'this tab keeps the originals');

    // Another tab saves (the same state plus its own change): this tab takes it and keeps its full-size photos.
    saved.state.events.push({ id: 'e_other_tab', ts: '2099-01-01T00:00:00.000Z', actor: 'runner', text: 'From the other tab.', money: null });
    win.dispatchEvent(Object.assign(new Event('storage'), { key: KEY, newValue: JSON.stringify(saved) }));
    const s = await state();
    assert.ok(s.events.some((e) => e.id === 'e_other_tab'));
    assert.deepEqual(s.items.find((i) => i.id === levis.id)?.photos, shots);
    // junk and other keys are ignored
    win.dispatchEvent(Object.assign(new Event('storage'), { key: KEY, newValue: '{junk' }));
    win.dispatchEvent(Object.assign(new Event('storage'), { key: 'offload.api', newValue: 'mock' }));
    assert.equal((await state()).events.length, s.events.length);
  } finally {
    delete (globalThis as { window?: unknown }).window;
    useStorage(storage);
    mock.forgetMockMemory();
  }
});

test('handover with nothing photographed lists nothing; a lone photo is never the claim close-up', async () => {
  await reset();
  const p = await post<Pickup>('/api/pickups', { ...MAYA, frames_b64: [photo(1)], transcript: '' });
  const out = await post<Pickup>(`/api/pickups/${p.id}/handover`);
  assert.equal(out.status, 'estimated');
  let s = await state();
  assert.ok(eventTexts(s).includes("Nothing's ready to list yet. Waiting on the runner's photos."));
  assert.ok(itemsOf(s, p.id).every((i) => i.status === 'estimated'));

  const painted = byKey(itemsOf(s, p.id), 'painted-denim');
  const one = await post<Item>(`/api/items/${painted.id}/photos`, { photos_b64: [photo(7)] });
  assert.equal(one.status, 'photographed');
  assert.equal(one.claim_proof, null);
  const listed = await post<Pickup>(`/api/pickups/${p.id}/handover`);
  assert.equal(listed.status, 'listed');
  s = await state();
  assert.equal(s.items.find((i) => i.id === painted.id)?.status, 'listed');
  assert.ok(
    eventTexts(s).includes(
      `Kept "hand-painted by her sister" off the listing for the hand-painted denim jacket. There's no clear close-up of the painted lettering yet, and we only say what buyers can see.`,
    ),
  );
});

test('artificial latency is 150-400 ms and deterministic', async () => {
  await reset();
  mock.configureMock({ latency: 1 });
  try {
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t = performance.now();
      await state();
      times.push(performance.now() - t);
    }
    for (const t of times) assert.ok(t >= 140 && t < 700, `took ${t}ms`);
  } finally {
    mock.configureMock({ latency: 0 });
  }
});
