// End-to-end smoke test against a running backend. Walks every contract route and the demo steps.
// Usage: node scripts/smoke.js [http://localhost:8787]
// Works with no API keys (every service falls back), and with real keys.
// WARNING: it calls /api/demo/reset first, so it wipes the state back to the seed.
import sharp from 'sharp';

const BASE = (process.argv[2] || 'http://localhost:8787').replace(/\/+$/, '');
const PROMPTS = [
  'Show me the label', 'Turn it round', 'Any marks or damage?', 'Show the size tag', 'Anything special about it?',
  'What would you want for this one?', 'Show me the signature or the change up close', 'Hold it up flat',
  'Got it, next item', 'Looks good, you can stop',
];

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
  return cond;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body) {
  const started = Date.now();
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', 'ngrok-skip-browser-warning': '1' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, json, ms: Date.now() - started };
}
const post = (p, b = {}) => call('POST', p, b);
const state = async () => (await call('GET', '/api/state')).json;

const isInt = (v) => Number.isInteger(v);
const keys = (o) => Object.keys(o || {}).sort().join(',');
const SHAPES = {
  pickup: 'address,created_at,estimate_high,estimate_low,id,preview,runner_name,seller_name,status,transcript',
  item: 'brand,claim,claim_proof,comps,condition_notes,floor_price,grade,id,label,list_price,photo_requests,photos,pickup_id,price_confidence,price_source,proof_request,seller_ask,seller_proof,seller_story,shopify_url,size,special,status,type',
  job: 'address,id,item_ids,pay,pickup_id,runner_name,status,type',
  offer: 'amount,buyer,counter,discount_code,id,item_id,round,status',
  ledger: 'id,item_id,our_amount,runner_amount,sale_price,seller_amount',
  event: 'actor,id,money,text,ts',
};

async function image(color) {
  const buf = await sharp({ create: { width: 64, height: 80, channels: 3, background: color } }).jpeg().toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

async function main() {
  console.log(`Smoke test against ${BASE}\n`);
  const img = await image('#3b5bdb');
  const img2 = await image('#f08c00');

  // --- state + reset ---
  let s = await state();
  ok(s && ['pickups', 'items', 'jobs', 'offers', 'ledger', 'events'].every((k) => Array.isArray(s[k])), 'GET /api/state has all six arrays');
  ok((await post('/api/demo/reset')).json?.ok === true, 'POST /api/demo/reset -> { ok: true }');
  s = await state();
  for (const [kind, list] of [['pickup', s.pickups], ['item', s.items], ['job', s.jobs], ['offer', s.offers], ['ledger', s.ledger], ['event', s.events]]) {
    ok(list.every((r) => keys(r) === SHAPES[kind]), `seed ${kind} rows match the contract exactly (${list.length})`);
  }
  ok(s.items.every((i) => !('meta' in i)), 'internal meta never leaks into state');

  // --- live frame ---
  const lf = await post('/api/live/frame', { frame_b64: img, transcript: 'this is my old denim jacket' });
  ok(lf.status === 200 && PROMPTS.includes(lf.json?.prompt) && typeof lf.json?.notes === 'string', `live frame -> prompt from the fixed list ("${lf.json?.prompt}") in ${lf.ms}ms`);
  ok(lf.ms < 3500, 'live frame answers inside the 2.5s budget (+ slack)');

  // --- estimate ---
  const transcript =
    "Right, so this is my Levi's trucker jacket, had it years. This jersey is signed by Kobe Bryant, my uncle got it at a game. I painted this denim jacket myself, I want eighty quid for it.";
  const pr = await post('/api/pickups', { seller_name: 'Tester', address: '1 Test Street, London E8 1AA', frames_b64: [img, img2], transcript });
  ok(pr.status === 200 && keys(pr.json) === SHAPES.pickup, `POST /api/pickups -> Pickup shape (${pr.ms}ms)`);
  const pickup = pr.json;
  ok(pickup.status === 'estimated' && pickup.preview.length > 0, `pickup estimated with ${pickup.preview.length} preview lines`);
  ok(pickup.estimate_low === pickup.preview.reduce((a, p) => a + p.low, 0) && pickup.estimate_high === pickup.preview.reduce((a, p) => a + p.high, 0), 'estimate totals = sum of preview lines');
  s = await state();
  let items = s.items.filter((i) => i.pickup_id === pickup.id);
  ok(items.length === pickup.preview.length && items.every((i) => i.status === 'estimated'), 'items created with status "estimated"');
  ok(items.every((i) => isInt(i.list_price) && isInt(i.floor_price) && i.floor_price <= i.list_price), 'items have integer list/floor prices');
  ok(s.events.some((e) => /^Spotted \d+ items?\. Expect £/.test(e.text) && e.money === pickup.estimate_high), 'event "Spotted N items. Expect £X to £Y." with money = estimate_high');

  // --- book, accept, done ---
  const jb = await post(`/api/pickups/${pickup.id}/book`);
  ok(jb.status === 200 && keys(jb.json) === SHAPES.job && jb.json.type === 'pickup' && jb.json.status === 'open', 'book -> open pickup Job');
  ok(jb.json.pay === 600 * items.length, `pickup job pay = 600 x ${items.length}`);
  ok((await post(`/api/pickups/${pickup.id}/book`)).json?.id === jb.json.id, 'booking twice returns the same job');
  const acc = await post(`/api/jobs/${jb.json.id}/accept`, { runner_name: 'Sam' });
  ok(acc.json?.status === 'accepted' && acc.json?.runner_name === 'Sam', 'accept -> accepted by Sam');
  const dn = await post(`/api/jobs/${jb.json.id}/done`);
  ok(dn.json?.status === 'done', 'done -> done');
  s = await state();
  ok(s.pickups.find((p) => p.id === pickup.id)?.status === 'collected', 'pickup -> collected');

  // --- photos ---
  for (const it of items) {
    let r = await post(`/api/items/${it.id}/photos`, { photos_b64: [img, img2, img, img2] });
    for (let n = 0; n < 3 && r.json?.status === 'needs_photos'; n++) {
      ok(r.json.photo_requests.length > 0, `needs_photos comes with photo_requests (${it.label})`);
      r = await post(`/api/items/${it.id}/photos`, { photos_b64: [img2] });
    }
    ok(r.status === 200 && keys(r.json) === SHAPES.item && r.json.status === 'photographed', `photos -> photographed: ${it.label} grade ${r.json?.grade}, ${r.json?.price_source} £${r.json?.list_price / 100} (${r.ms}ms)`);
    ok(r.json.photos.length >= 4 && ['A', 'B', 'C', 'D'].includes(r.json.grade), 'photos stored and graded A-D');
  }

  // --- ask + proof ---
  s = await state();
  items = s.items.filter((i) => i.pickup_id === pickup.id);
  const askItem = items[0];
  const ask = await post(`/api/items/${askItem.id}/ask`, { seller_ask: 8000 });
  ok(ask.json?.list_price === 8000 && ask.json?.floor_price === 6400 && ask.json?.price_source === 'seller', 'ask 8000 -> list 8000, floor 6400, source seller');
  ok((await post(`/api/items/${askItem.id}/ask`, { seller_ask: 'lots' })).status === 400, 'bad seller_ask -> 400');
  const proofItem = items.find((i) => i.claim) || items[1];
  const pf = await post(`/api/items/${proofItem.id}/proof`, { photos_b64: [img], note: 'Photo from the signing' });
  ok(pf.json?.seller_proof?.length === 1 && pf.json?.proof_request === null, 'proof -> seller_proof stored, proof_request cleared');

  // --- handover ---
  const ho = await post(`/api/pickups/${pickup.id}/handover`);
  ok(ho.status === 200 && ho.json?.status === 'listed', `handover -> pickup listed (${ho.ms}ms)`);
  s = await state();
  items = s.items.filter((i) => i.pickup_id === pickup.id);
  ok(items.every((i) => i.status === 'listed'), 'every photographed item is listed');
  ok(s.events.some((e) => /^Listed .+ at £/.test(e.text)), 'event "Listed ... at £X."');

  // --- offers ---
  const target = items.find((i) => i.id !== askItem.id) || items[0];
  const low = Math.max(100, Math.round(target.floor_price * 0.6));
  const o1 = await post('/api/offers', { item_id: target.id, amount: low, buyer: 'Grok Bot' });
  const mid = Math.round((low + target.list_price) / 2 / 100) * 100;
  ok(o1.json?.status === 'countered' && o1.json.round === 1 && o1.json.counter === Math.min(target.list_price, Math.max(target.floor_price, mid)), `round 1 below floor -> countered at ${o1.json?.counter}`);
  const o2 = await post('/api/offers', { item_id: target.id, amount: o1.json.counter, buyer: 'Grok Bot' });
  ok(o2.json?.status === 'accepted' && o2.json.round === 2, 'round 2 at the counter -> accepted');
  ok(o2.json.counter === null && keys(o2.json) === SHAPES.offer, 'offer shape exact');
  const other = items.find((i) => i.id !== target.id);
  if (other) {
    await post('/api/offers', { item_id: other.id, amount: 100, buyer: 'Lowballer' });
    const rj = await post('/api/offers', { item_id: other.id, amount: 100, buyer: 'Lowballer' });
    ok(rj.json?.status === 'rejected' && rj.json.round === 2, 'round 2 below floor -> rejected');
  }
  ok((await post('/api/offers', { item_id: target.id, amount: 'abc', buyer: 'x' })).status === 400, 'bad amount -> 400');
  ok((await post('/api/offers', { item_id: 'i_nope', amount: 100, buyer: 'x' })).status === 404, 'unknown item -> 404');

  // --- demo path ---
  ok((await post('/api/demo/estimate')).json?.ok === true, 'demo estimate');
  s = await state();
  const demoPickup = s.pickups[s.pickups.length - 1];
  ok(demoPickup && demoPickup.id !== pickup.id && demoPickup.status === 'estimated', 'demo estimate made a new pickup');
  ok((await post('/api/demo/photos')).json?.ok === true, 'demo photos (pass 1)');
  await sleep(9000);
  s = await state();
  let demoItems = s.items.filter((i) => i.pickup_id === demoPickup.id);
  ok(demoItems.every((i) => ['photographed', 'needs_photos'].includes(i.status)), `demo items photographed (${demoItems.map((i) => i.status).join(', ')})`);
  if (demoItems.some((i) => i.status === 'needs_photos')) {
    await post('/api/demo/photos');
    await sleep(3000);
    s = await state();
    demoItems = s.items.filter((i) => i.pickup_id === demoPickup.id);
    ok(demoItems.every((i) => i.status === 'photographed'), 'demo photos (pass 2) fixed the retake');
  }
  ok((await post('/api/demo/sale')).json?.ok === true, 'demo sale');
  let sold = null;
  for (let t = 0; t < 40 && !sold; t++) {
    await sleep(1000);
    s = await state();
    sold = s.items.find((i) => i.pickup_id === demoPickup.id && i.status === 'sold');
  }
  ok(Boolean(sold), `demo sale sold ${sold?.label}`);
  if (sold) {
    const l = s.ledger.find((r) => r.item_id === sold.id);
    ok(l && l.seller_amount === Math.round(l.sale_price * 0.7) && l.runner_amount === 600 && l.our_amount === l.sale_price - l.seller_amount - 600, 'ledger split 70% / 600p / rest');
    ok(s.events.some((e) => e.money === l?.sale_price && /^Sold /.test(e.text)), 'sale event carries money = sale price');
    const postJob = s.jobs.find((j) => j.type === 'post' && j.item_ids.includes(sold.id));
    ok(postJob && postJob.pay === 600, 'post job created with pay 600');
    const pd = await post(`/api/jobs/${postJob.id}/done`);
    s = await state();
    ok(pd.json?.status === 'done' && s.items.find((i) => i.id === sold.id)?.status === 'posted', 'post job done -> item posted');
    const offers = s.offers.filter((o) => o.item_id === sold.id);
    ok(offers.some((o) => o.status === 'countered') && offers.some((o) => o.status === 'accepted'), 'demo negotiation: countered then accepted');
  }

  // --- errors + hygiene ---
  ok((await post('/api/demo/nope')).status === 404, 'unknown demo step -> 404');
  ok((await call('POST', '/api/offers', '{bad json')).status === 400, 'invalid JSON -> 400');
  ok((await call('GET', '/api/nope')).status === 404, 'unknown route -> 404');
  const pre = await fetch(BASE + '/api/state', { method: 'OPTIONS', headers: { Origin: 'https://x.vercel.app', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,ngrok-skip-browser-warning' } });
  ok(pre.headers.get('access-control-allow-origin') === '*', 'CORS preflight allows any origin');
  s = await state();
  ok(s.events.every((e, i, a) => i === 0 || a[i - 1].ts <= e.ts), 'events are in time order');
  ok(s.events.every((e) => !/as an ai/i.test(e.text)), 'no "As an AI" in the feed');

  console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASSED'}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('Smoke test crashed:', e);
  process.exit(1);
});
