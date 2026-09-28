// POST /api/demo/:step - pushes the cached next step (the UI's hidden keys).
// Uses cache/demo.json first and never waits on a model. Each step fast-forwards anything that hasn't happened yet,
// through the same flows the real routes use, so the feed, ledger and Shopify all stay consistent.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, has } from './config.js';
import { state, itemsOf, event, reset as resetStore } from './store.js';
import * as flows from './flows.js';
import * as comps from './comps.js';
import * as shopify from './shopify.js';
import { roundPounds, sleep, warn, log } from './util.js';

export const STEPS = ['estimate', 'photos', 'sale', 'reset'];

let cache = null;
let generation = 0; // bumped on reset so sequences still running stop quietly
const busy = new Set();
const again = new Set(); // a photos press that came in while photos was still running

export function loadCache() {
  try {
    cache = JSON.parse(fs.readFileSync(path.join(ROOT, 'cache', 'demo.json'), 'utf8'));
  } catch (e) {
    warn(`No demo cache loaded (${e.message})`);
    cache = null;
  }
  flows.setDemoCache(cache);
  for (const ci of cache?.items || []) {
    comps.preload(`demo:${ci.key}`, ci.comps || []);
    if (ci.search_query) comps.preload(ci.search_query, ci.comps || []);
  }
  if (cache) log(`Demo cache loaded: ${cache.items?.length || 0} items`);
  return cache;
}

const alive = (gen) => gen === generation;
const runnerName = (pickup) => pickup?.runner_name || cache?.runner_name || 'Sam';

function demoPickup() {
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const p = state.pickups[i];
    if (itemsOf(p.id).some((it) => it.meta?.demo_key)) return p;
  }
  return null;
}

const demoItems = (pickup) => itemsOf(pickup.id).filter((it) => it.meta?.demo_key && flows.demoItem(it.meta.demo_key));

// ---------- steps ----------

function doEstimate() {
  const existing = demoPickup();
  // A second press doesn't make a second pile while this one is still on its way to the shop; once it's listed, E starts a fresh run.
  if (existing && existing.status !== 'listed') return existing;
  return flows.createPickup({
    seller_name: cache.seller_name,
    address: cache.address,
    transcript: cache.transcript,
    estimates: cache.items.map(flows.estimateFromCache),
    demo: true,
  });
}

async function collect(pickup, gen) {
  if (['collected', 'listed'].includes(pickup.status)) return;
  const job = state.jobs.find((j) => j.type === 'pickup' && j.pickup_id === pickup.id) || flows.book(pickup);
  if (job.status === 'open') {
    await sleep(800);
    if (!alive(gen)) return;
    flows.acceptJob(job, runnerName(pickup));
  }
  if (job.status === 'accepted') {
    await sleep(800);
    if (!alive(gen)) return;
    flows.jobDone(job);
  }
}

async function firstPass(it) {
  const ci = flows.demoItem(it.meta.demo_key);
  it.photos = [...(ci.photos || [])];
  it.meta.cache_graded = true; // graded from the cache, so the listing uses the cache description too
  if (ci.retake && !it.meta.retake_rounds) {
    it.grade = ci.grade || null;
    it.condition_notes = [...(ci.condition_notes || [])];
    flows.needsPhotos(it, ci.retake.photo_requests, ci.retake.request_summary);
    return;
  }
  await flows.finishGrading(
    it,
    { grade: ci.grade, condition_notes: ci.condition_notes, special: ci.special, claim_proof: ci.claim_proof },
    { comps: ci.comps || [] },
  );
}

async function retake(it, pickup) {
  const ci = flows.demoItem(it.meta.demo_key);
  const r = ci.retake || {};
  const extra = r.photos_after || [];
  it.meta.cache_graded = true;
  if (extra.length) {
    it.photos.push(...extra);
    event('runner', `${runnerName(pickup)} sent ${extra.length === 1 ? 'a new photo' : 'new photos'} of ${flows.the(it)}.`);
  }
  await flows.finishGrading(
    it,
    { grade: ci.grade, condition_notes: ci.condition_notes, special: ci.special, claim_proof: r.claim_proof || ci.claim_proof },
    { comps: ci.comps || [] },
  );
}

// First press: runner collects and photographs everything (one item needs a retake).
// Next press: the retake comes in and that item is graded too.
async function doPhotos(gen) {
  const pickup = demoPickup() || doEstimate();
  await collect(pickup, gen);
  const items = demoItems(pickup);
  const retakes = items.filter((it) => it.status === 'needs_photos');
  const queue = retakes.length ? retakes : items.filter((it) => it.status === 'estimated');
  for (const it of queue) {
    await sleep(900);
    if (!alive(gen)) return;
    if (it.status !== (retakes.length ? 'needs_photos' : 'estimated')) continue; // S already handled it
    if (retakes.length) await retake(it, pickup);
    else await firstPass(it);
  }
}

function pickTarget(pickup, buyer) {
  const open = itemsOf(pickup.id).filter(
    (i) => ['listed', 'offer'].includes(i.status) && !state.offers.some((o) => o.item_id === i.id && o.buyer === buyer),
  );
  return open.find((i) => i.meta?.demo_key === cache.sale?.item_key) || open[0] || null;
}

// Grok Bot offers below the floor, the agent counters, Grok Bot takes it, the order lands, the money splits.
async function doSale(gen) {
  const pickup = demoPickup() || doEstimate();
  const items = demoItems(pickup);
  if (items.some((i) => ['estimated', 'needs_photos'].includes(i.status))) {
    await collect(pickup, gen);
    if (!alive(gen)) return;
    for (const it of items.filter((i) => i.status === 'estimated')) {
      if (!alive(gen)) return;
      await firstPass(it);
    }
    for (const it of items.filter((i) => i.status === 'needs_photos')) {
      if (!alive(gen)) return;
      await retake(it, pickup);
    }
  }
  if (!alive(gen)) return;
  if (pickup.status !== 'listed' || itemsOf(pickup.id).some((i) => i.status === 'photographed')) await flows.handover(pickup);
  if (!alive(gen)) return;

  const buyer = cache.sale?.buyer || 'Grok Bot';
  let item = pickTarget(pickup, buyer);
  for (let t = 0; t < 40 && !item; t++) {
    await sleep(500); // a late listing may still be on its way to Shopify
    if (!alive(gen)) return;
    item = pickTarget(pickup, buyer);
  }
  if (!item) {
    event('agent', 'Nothing new to sell yet. Everything listed already has an offer.');
    return;
  }

  let first = item.meta.demo_key === cache.sale?.item_key && cache.sale?.first_offer ? cache.sale.first_offer : roundPounds(item.floor_price * 0.8);
  if (first >= item.floor_price) first = Math.max(100, item.floor_price - 500);

  await sleep(800);
  if (!alive(gen)) return;
  const o1 = await flows.makeOffer({ item, amount: first, buyer });
  let agreed = o1.status === 'accepted' ? o1.amount : null;
  if (o1.status === 'countered') {
    await sleep(2500);
    if (!alive(gen)) return;
    const o2 = await flows.makeOffer({ item, amount: o1.counter, buyer });
    if (o2.status === 'accepted') agreed = o2.amount;
  }
  if (!agreed) return;

  await sleep(2500);
  if (!alive(gen)) return;
  let orderId = null;
  if (has.shopify() && item.meta.shopify_variant_id) {
    try {
      const order = await shopify.createDemoOrder({ variantId: item.meta.shopify_variant_id, discountAmount: item.list_price - agreed, email: 'grok-bot@example.com' });
      orderId = order.orderId || null;
      log(`Demo order ${order.name} placed on Shopify`);
    } catch (e) {
      warn(`Demo order failed (${e.message}), recording the sale directly`);
    }
  }
  if (!alive(gen)) return;
  flows.recordSale(item, agreed, { orderId }); // no-op if the order poller got there first
}

async function doReset() {
  generation++;
  busy.clear();
  again.clear();
  await resetStore();
  flows.resetLive();
}

// A second press while a step runs: photos runs once more afterwards (the retake lands); sale ignores it.
function background(step, fn) {
  if (busy.has(step)) {
    if (step === 'photos') again.add(step);
    return;
  }
  busy.add(step);
  const gen = generation;
  fn(gen)
    .catch((e) => warn(`Demo ${step} failed: ${e.message}`))
    .finally(() => {
      if (!alive(gen)) return;
      busy.delete(step);
      if (again.delete(step)) background(step, fn);
    });
}

export async function runStep(step) {
  if (!STEPS.includes(step)) throw new flows.HttpError(404, `Unknown demo step "${step}". Use estimate, photos, sale or reset.`);
  if (step === 'reset') return doReset();
  if (!cache?.items?.length) throw new flows.HttpError(503, 'The demo cache is missing (server/cache/demo.json).');
  if (step === 'estimate') doEstimate();
  else if (step === 'photos') background('photos', doPhotos);
  else background('sale', doSale);
}
