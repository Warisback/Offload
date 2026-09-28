// Business actions shared by the routes and the demo steps.
// Every model or network call has a timeout and a plain fallback, and every step leaves one human line in the feed.
import { config, has } from './config.js';
import { state, find, itemsOf, add, save, event } from './store.js';
import { priceItem, previewRange, counterOffer, split, TYPES, TIERS, RUNNER_FEE } from './pricing.js';
import * as comps from './comps.js';
import * as claude from './claude.js';
import * as gemini from './gemini.js';
import * as openai from './openai.js';
import * as shopify from './shopify.js';
import * as storage from './storage.js';
import { prepareImage, sample } from './images.js';
import { id, nowIso, gbp, norm, clip, withTimeout, warn, toPence } from './util.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// The "£6" posting card. It is the same money as the ledger's runner_amount, so never add the two together.
export const POST_JOB_PAY = RUNNER_FEE;

// ---------- demo cache link (set at boot by demo.js) ----------

let demoCache = null;
export const setDemoCache = (c) => (demoCache = c);
export const getDemoCache = () => demoCache;
export const demoItem = (key) => (key && demoCache?.items?.find((i) => i.key === key)) || null;

function matchDemo(label, brand, used) {
  const hay = norm(`${label} ${brand || ''}`);
  return demoCache?.items?.find((ci) => !used?.has(ci.key) && ci.match?.length && ci.match.every((w) => hay.includes(norm(w)))) || null;
}

// ---------- small helpers ----------

const list = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : []);
const isUrl = (u) => typeof u === 'string' && /^https?:\/\//.test(u);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Leading words that read lowercase mid-sentence ("the wool jumper"); anything else is kept ("the Lakers jersey").
const COMMON = new Set(
  ('vintage retro old classic unbranded custom customised customized handmade hand-made hand-painted painted hand signed ' +
    'embroidered wool knit knitted cotton linen silk suede leather faux denim corduroy cashmere fleece quilted waxed wax ' +
    'black white blue grey gray red green navy brown pink cream beige khaki olive yellow orange purple light dark washed ' +
    'hand-embroidered hand-knitted hand-sewn hand-stitched crochet crocheted reworked upcycled patchwork teal burgundy maroon mustard lilac lavender ivory charcoal camel rust sage coral mint tan gold silver multicoloured ' +
    'distressed ripped oversized cropped baggy slim straight wide plain striped floral check checked tartan graphic long ' +
    'short sleeveless puffer bomber trucker chunky mini midi maxi summer winter little big football basketball band tour ' +
    'jacket jeans hoodie sweatshirt jumper cardigan coat shirt tee t-shirt dress skirt trousers shorts blazer trainers boots')
    .split(' '),
);

// "the Levi's denim jacket", "the hand-painted denim jacket", "the Lakers jersey"
export function the(item) {
  const l = item.label || 'item';
  const first = l.split(/\s+/)[0].toLowerCase().replace(/[^a-z-]/g, '');
  return `the ${COMMON.has(first) ? l.charAt(0).toLowerCase() + l.slice(1) : l}`;
}

const sellerOf = (item) => find('pickups', item.pickup_id)?.seller_name || 'The seller';

// True once a reset has replaced the state, so a flow still waiting on the network stops quietly.
const gone = (row, kind = 'items') => find(kind, row.id) !== row;

function applyPrice(item) {
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

function refreshPreview(pickup) {
  const items = itemsOf(pickup.id);
  pickup.preview = items.map((it) => ({
    label: it.label,
    ...previewRange({ type: it.type, brand_tier: it.meta.brand_tier, special: it.special, seller_ask: it.seller_ask, comps: it.comps }),
  }));
  pickup.estimate_low = pickup.preview.reduce((s, p) => s + p.low, 0);
  pickup.estimate_high = pickup.preview.reduce((s, p) => s + p.high, 0);
  save('pickups', pickup);
}

// ---------- live filming ----------

const FIRST_PROMPT = 'Show me the label';
export const live = { prompt: FIRST_PROMPT, notes: '' };
export function resetLive() {
  live.prompt = FIRST_PROMPT;
  live.notes = '';
}

// One fast-model call per frame, hard 2.5 s budget: OpenAI first, Gemini only if OpenAI errors in time.
// On timeout or failure: the previous prompt. Warnings are rate-limited (frames arrive every couple of seconds).
const lastWarn = {};
function warnSometimes(key, msg) {
  if (Date.now() - (lastWarn[key] || 0) < 30000) return;
  lastWarn[key] = Date.now();
  warn(msg);
}

export async function liveFrame({ frame_b64, transcript }) {
  if (!frame_b64 || (!has.openai() && !has.gemini())) return { prompt: live.prompt, notes: live.notes };
  const started = Date.now();
  const left = () => config.timeouts.live - (Date.now() - started);
  const args = (frame, timeoutMs) => ({ frame, transcript: String(transcript || ''), previousPrompt: live.prompt, timeoutMs });
  try {
    const frame = await prepareImage(frame_b64, { maxEdge: 512, quality: 70 });
    let out = null;
    if (has.openai()) {
      out = await withTimeout(openai.livePrompt(args(frame, left())), left() + 50, 'live frame').catch((e) => {
        if (e.name !== 'TimeoutError' && !/timed out/.test(e.message)) warnSometimes('openai', `Live prompt (OpenAI) failed: ${e.message}`);
        return null;
      });
    }
    if (!out && has.gemini() && left() > 600) {
      out = await withTimeout(gemini.livePrompt(args(frame, left())), left() + 50, 'live frame').catch((e) => {
        if (e.name !== 'TimeoutError') warnSometimes('gemini', `Live prompt (Gemini) failed: ${e.message}`);
        return null;
      });
    }
    if (out) {
      live.prompt = out.prompt;
      live.notes = out.notes || '';
    }
  } catch (e) {
    warnSometimes('frame', `Live frame failed: ${e.message}`);
  }
  return { prompt: live.prompt, notes: live.notes };
}

// ---------- estimate ----------

function cleanEstimate(e) {
  const type = TYPES.includes(e.type) ? e.type : 'other';
  const brand = e.brand ? String(e.brand).trim() : null;
  const claim = e.claim ? String(e.claim).trim() : null;
  return {
    label: clip(String(e.label || e.type_label || 'Item').trim(), 80),
    brand,
    type,
    type_label: e.type_label || type,
    size: e.size ? String(e.size).trim() : null,
    brand_tier: TIERS.includes(e.brand_tier) ? e.brand_tier : brand ? 'high street' : 'unknown',
    condition_notes: list(e.condition_notes),
    special: e.special || null,
    claim,
    claim_noun: claim ? e.claim_noun || 'it' : null,
    claim_line: claim ? e.claim_line || null : null,
    seller_ask: toPence(e.seller_ask),
    seller_story: e.seller_story || null,
    story_safe: claim ? e.story_safe || null : null,
    proof_request: claim
      ? e.proof_request || `You said it's ${claim}. Do you have a photo of that, a receipt or a certificate?`
      : null,
    search_query: e.search_query || null,
    demo_key: e.demo_key || null,
  };
}

// Turns a demo cache item into the same shape Claude's estimate returns.
export const estimateFromCache = (ci) => ({
  ...ci,
  condition_notes: ci.estimate_notes || [],
  special: null, // confirmed from the runner's photos
  demo_key: ci.key,
});

function newItem(pickup, est, demo) {
  const ci = demoItem(est.demo_key); // assigned per pile in linkDemoPile
  const item = {
    id: id('i'),
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
    comps: [],
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
      demo: Boolean(demo),
      retake_rounds: 0,
    },
  };
  item.comps = comps.cached(item) || []; // comps if cached, table otherwise
  applyPrice(item);
  return item;
}

// A live pile links to the demo cache only when it clearly is the demo pile, with one cache item per live item.
function linkDemoPile(cleaned) {
  const used = new Set(cleaned.map((e) => e.demo_key).filter(Boolean)); // cache-fallback estimates keep their keys
  for (const e of cleaned) {
    if (e.demo_key) continue;
    const ci = matchDemo(e.label, e.brand, used);
    if (ci) {
      e.demo_key = ci.key;
      used.add(ci.key);
    }
  }
  if (used.size < Math.min(3, demoCache?.items?.length || 3)) cleaned.forEach((e) => (e.demo_key = null)); // not the demo pile: no cache link
}

// The demo pile filmed live, but Claude named an item differently from the cache: pair it with a free cache item
// so the demo steps still photograph and list it. Only when at least half the pile already matched.
function pairLeftovers(items) {
  const used = new Set(items.map((i) => i.meta.demo_key).filter(Boolean));
  if (!demoCache?.items?.length || used.size * 2 < items.length) return;
  for (const it of items.filter((i) => !i.meta.demo_key)) {
    const free = demoCache.items.filter((c) => !used.has(c.key));
    const ci = free.find((c) => c.type === it.type) || free[0];
    if (!ci) break;
    used.add(ci.key);
    it.meta.demo_key = ci.key;
    it.comps = comps.cached(it) || [];
    applyPrice(it);
  }
}

export function createPickup({ seller_name, address, transcript, estimates, demo = false }) {
  const pickup = {
    id: id('p'),
    seller_name: clip(String(seller_name || '').trim() || 'Seller', 80),
    address: clip(String(address || '').trim(), 200),
    transcript: String(transcript || ''),
    estimate_low: 0,
    estimate_high: 0,
    preview: [],
    status: 'estimated',
    runner_name: null,
    created_at: nowIso(),
  };
  const cleaned = (estimates || []).map(cleanEstimate);
  if (!demo) linkDemoPile(cleaned);
  const items = cleaned.map((e) => newItem(pickup, e, demo));
  if (!demo) pairLeftovers(items);
  add('pickups', pickup);
  for (const it of items) add('items', it);
  refreshPreview(pickup);

  const n = items.length;
  if (n) event('agent', `Spotted ${n} item${n === 1 ? '' : 's'}. Expect ${gbp(pickup.estimate_low)} to ${gbp(pickup.estimate_high)}.`, pickup.estimate_high);
  else event('agent', "Couldn't make out any clothes in that video. Mind trying again in better light?");
  for (const it of items) {
    if (it.seller_ask) event('agent', `Noted you want ${gbp(it.seller_ask)} for ${the(it)}.`);
    if (it.proof_request) event('agent', `Asked the seller for proof of ${it.meta.claim_noun}.`);
  }
  resetLive();
  comps.warm(items); // so comps are ready by the time the runner's photos land
  return pickup;
}

// The cache pile stands in only for the demo pile: the seller is the demo seller, or the transcript names most of it.
function isDemoPile(sellerName, transcript) {
  if (!demoCache?.items?.length) return false;
  if (norm(sellerName) && norm(sellerName) === norm(demoCache.seller_name)) return true;
  const said = norm(transcript);
  const hits = demoCache.items.filter((ci) => ci.match?.length && ci.match.every((w) => said.includes(norm(w)))).length;
  return hits >= Math.min(3, demoCache.items.length);
}

function fallbackEstimates(sellerName, transcript) {
  if (isDemoPile(sellerName, transcript)) {
    warn('Using the demo cache as the estimate fallback');
    return demoCache.items.map(estimateFromCache);
  }
  event('agent', "Couldn't look at the video properly just now. The runner will photograph everything.");
  return [{ label: 'Bag of clothes', type: 'other', brand_tier: 'unknown', seller_story: clip(transcript, 300) || null }];
}

export async function estimateFromVideo({ seller_name, address, frames_b64, transcript, audio_b64 = null }) {
  // The browser couldn't caption the seller: transcribe their recorded voice while the frames are prepared.
  const heard = audio_b64 && has.openai()
    ? openai.transcribe(audio_b64).catch((e) => {
        warn(`Voice transcription failed (${e.message})`);
        return '';
      })
    : Promise.resolve('');
  const frames = (
    await Promise.all(sample(frames_b64 || [], 12).map((f) => prepareImage(f, { maxEdge: 1024, quality: 75 }).catch(() => null)))
  ).filter(Boolean);
  const voice = await heard;
  if (voice) transcript = [voice, String(transcript || '').trim()].filter(Boolean).join(' ');
  let estimates;
  try {
    estimates = (await claude.estimatePile({ frames, transcript: String(transcript || ''), sellerName: seller_name })).items;
  } catch (e) {
    warn(`Estimate fell back (${e.message})`);
    estimates = fallbackEstimates(String(seller_name || ''), String(transcript || ''));
  }
  return createPickup({ seller_name, address, transcript, estimates });
}

// ---------- jobs ----------

const shortAddress = (a) => (a || '').split(',')[0].trim() || 'the seller';

export function book(pickup) {
  const existing = state.jobs.find((j) => j.type === 'pickup' && j.pickup_id === pickup.id);
  if (existing) return existing;
  const items = itemsOf(pickup.id);
  const job = {
    id: id('j'),
    type: 'pickup',
    pickup_id: pickup.id,
    item_ids: items.map((i) => i.id),
    runner_name: null,
    address: pickup.address,
    pay: RUNNER_FEE * items.length,
    status: 'open',
  };
  add('jobs', job);
  if (pickup.status === 'estimated') pickup.status = 'booked';
  save('pickups', pickup);
  event('agent', 'Runner booked for pickup.');
  return job;
}

export function acceptJob(job, runnerName) {
  if (job.status !== 'open') return job; // already taken
  const name = clip(String(runnerName || '').trim(), 60) || 'A runner';
  job.status = 'accepted';
  job.runner_name = name;
  save('jobs', job);
  if (job.type === 'pickup') {
    const p = find('pickups', job.pickup_id);
    if (p) {
      p.runner_name = name;
      save('pickups', p);
    }
    event('runner', `${name} accepted the pickup at ${shortAddress(job.address)}.`);
  } else {
    const it = find('items', job.item_ids[0]);
    event('runner', `${name} is posting ${it ? the(it) : 'the sale'}.`);
  }
  return job;
}

export function jobDone(job) {
  if (job.status === 'done') return job;
  job.status = 'done';
  save('jobs', job);
  const who = job.runner_name || 'The runner';
  if (job.type === 'pickup') {
    const p = find('pickups', job.pickup_id);
    if (p && (p.status === 'estimated' || p.status === 'booked')) {
      p.status = 'collected';
      save('pickups', p);
    }
    const n = job.item_ids.length;
    event('runner', `${who} collected ${n} item${n === 1 ? '' : 's'} from ${p?.seller_name || 'the seller'}.`);
  } else {
    const items = job.item_ids.map((i) => find('items', i)).filter(Boolean);
    for (const it of items) {
      if (it.status === 'sold') {
        it.status = 'posted';
        save('items', it);
      }
    }
    event('runner', `${who} posted ${items[0] ? the(items[0]) : 'the sale'}. It's on its way to the buyer.`);
  }
  return job;
}

// ---------- photos, grading, pricing ----------

const modelImages = new Map(); // photo url -> { data, mediaType } already sized for Claude

// Uploads to Supabase Storage. If storage is down, keeps small inline copies so the demo never stops.
export async function storePhotos(b64List, folder) {
  const prepared = await Promise.all(b64List.map((b) => prepareImage(b, { maxEdge: 1600, quality: 82 })));
  let urls;
  try {
    const stamp = Date.now();
    urls = await withTimeout(
      Promise.all(
        prepared.map((p, i) =>
          storage.uploadBuffer(p.buffer, `${folder}/${stamp}-${i}-${Math.random().toString(36).slice(2, 7)}.jpg`, 'image/jpeg'),
        ),
      ),
      config.timeouts.storage,
      'storage',
    );
  } catch (e) {
    warn(`Photo upload failed, keeping inline copies (${e.message})`);
    urls = await Promise.all(
      prepared.map(async (p) => `data:image/jpeg;base64,${(await prepareImage(p.buffer, { maxEdge: 480, quality: 60 })).data}`),
    );
  }
  urls.forEach((u, i) => modelImages.set(u, { data: prepared[i].data, mediaType: prepared[i].mediaType }));
  return urls;
}

async function imageForModel(url) {
  if (modelImages.has(url)) return modelImages.get(url);
  let input = url;
  if (isUrl(url)) {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`photo fetch ${r.status}`);
    input = Buffer.from(await r.arrayBuffer());
  }
  const p = await prepareImage(input);
  const img = { data: p.data, mediaType: p.mediaType };
  modelImages.set(url, img);
  return img;
}

function fallbackCheck(item, newUrls) {
  // The runner app sends the claim close-up last, so without Claude the last new photo stands in for it.
  const claim_proof = item.claim && newUrls.length > 1 ? newUrls[newUrls.length - 1] : null;
  const ci = demoItem(item.meta.demo_key);
  if (ci) return { photo_requests: [], grade: ci.grade, condition_notes: ci.condition_notes, special: ci.special, claim_proof };
  return { photo_requests: [], grade: 'B', condition_notes: item.condition_notes, special: item.special, claim_proof, fallback: true };
}

export function needsPhotos(item, requests, summary) {
  item.photo_requests = list(requests).slice(0, 3);
  item.status = 'needs_photos';
  item.meta.retake_rounds = (item.meta.retake_rounds || 0) + 1;
  item.meta.request_summary = summary || null;
  save('items', item);
  event('agent', `Asked the runner for ${summary || `another photo of ${the(item)}`}.`);
}

export async function photographItem(item, photos_b64) {
  const urls = await storePhotos(photos_b64, `items/${item.id}`);
  item.photos.push(...urls);
  save('items', item);

  const lenient = (item.meta.retake_rounds || 0) >= 2; // never trap the runner in a retake loop
  let check;
  try {
    const recent = item.photos.slice(-10);
    const used = (await Promise.all(recent.map(async (u) => ({ u, img: await imageForModel(u).catch(() => null) })))).filter((x) => x.img);
    if (!used.length) throw new Error('no readable photos');
    const out = await claude.checkPhotos({
      item: {
        label: item.label,
        brand: item.brand,
        type: item.type,
        size: item.size,
        claim: item.claim,
        claim_noun: item.meta.claim_noun,
        condition_notes: item.condition_notes,
        seller_story: item.seller_story,
        special: item.special,
      },
      photos: used.map((x) => x.img),
      lenient,
    });
    check = { ...out, claim_proof: Number.isInteger(out.claim_proof_index) ? used[out.claim_proof_index]?.u || null : null };
  } catch (e) {
    warn(`Photo check fell back for ${item.id} (${e.message})`);
    check = fallbackCheck(item, urls);
  }
  if (gone(item)) return item;

  if (check.photo_requests?.length && !lenient) {
    if (check.grade) item.grade = check.grade; // provisional, visible to the UI
    if (Array.isArray(check.condition_notes)) item.condition_notes = list(check.condition_notes);
    needsPhotos(item, check.photo_requests, check.request_summary);
    return item;
  }
  if (check.fallback) event('agent', `Couldn't look at the photos properly just now, so ${the(item)} is graded B for now.`);
  await finishGrading(item, check);
  return item;
}

// Comps from cache, else search (bounded). Late results re-price the item if it's still unlisted.
async function compsFor(item) {
  const hit = comps.cached(item);
  if (hit) return hit;
  const pending = comps.fetchComps(item);
  const found = await withTimeout(pending, 12000, 'comps wait').catch(() => null);
  if (found) return found;
  pending.then((late) => {
    if (late.length && item.status === 'photographed' && item.price_source === 'table') {
      item.comps = late;
      const p = applyPrice(item);
      save('items', item);
      event('agent', `Found prices for ${the(item)} after all. Similar ones sell around ${gbp(Math.round(p.raw / 100) * 100)}, so I'll list it at ${gbp(item.list_price)}.`);
    }
  });
  return [];
}

function gradingEvents(item, p) {
  const graded = `Graded ${the(item)} ${item.grade}.`;
  if (p.price_source === 'comps') {
    event('agent', `${graded} Similar ones sell around ${gbp(Math.round(p.raw / 100) * 100)}, so I'll list it at ${gbp(item.list_price)}.`);
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

const gradable = (item) => ['estimated', 'needs_photos', 'photographed'].includes(item.status);

// g = { grade, condition_notes, special, claim_proof, brand, size }
export async function finishGrading(item, g, { comps: given } = {}) {
  if (!gradable(item)) return item; // never pull a listed, offered or sold item back
  item.grade = ['A', 'B', 'C', 'D'].includes(g.grade) ? g.grade : 'B';
  if (Array.isArray(g.condition_notes)) item.condition_notes = list(g.condition_notes);
  if (g.special) item.special = g.special;
  if (g.brand && g.brand !== item.brand) {
    item.brand = g.brand; // the label beats the video
    if (item.meta.brand_tier === 'unknown') item.meta.brand_tier = 'high street';
  }
  if (g.size) item.size = g.size;
  if (item.claim && g.claim_proof) item.claim_proof = g.claim_proof;
  item.photo_requests = [];
  item.comps = given ?? (await compsFor(item));
  if (gone(item) || !gradable(item)) return item;
  const p = applyPrice(item);
  item.status = 'photographed';
  save('items', item);
  gradingEvents(item, p);
  if (find('pickups', item.pickup_id)?.status === 'listed') {
    listItem(item).catch((e) => warn(`Late listing failed: ${e.message}`)); // fixed items join the live listing
  }
  return item;
}

// ---------- listing ----------

const GRADE_WORDS = {
  A: 'In great condition, no marks we could find.',
  B: 'Good condition with light wear.',
  C: 'Clearly worn, with some marks.',
  D: 'Well worn, and priced to match.',
};

// Without a close-up, the claim stays off the listing entirely.
const safeStory = (item) => (item.claim && !item.claim_proof ? item.meta.story_safe || null : item.seller_story);
const showProof = (item) => item.seller_proof.length > 0 && (!item.claim || Boolean(item.claim_proof));

function claimLine(item) {
  const line = item.meta.claim_line;
  if (line && /^seller says/i.test(line.trim())) return line.trim();
  return `Seller says it's ${item.claim}. Close-up of ${item.meta.claim_noun || 'it'} included.`;
}

function proofLine(item) {
  const what = item.seller_proof.length === 1 ? 'a photo' : 'photos';
  const note = item.meta.proof_note ? ` Their note: "${clip(item.meta.proof_note, 160)}"` : '';
  return `Seller has shared ${what} to back this up, included in the pictures.${note}`;
}

// Rule 7: a claim never goes in the title as fact ("Signed Lakers jersey" -> "Lakers jersey").
function safeTitle(item, title) {
  if (!item.claim || !/\bsigned\b/i.test(title)) return title;
  return cap(title.replace(/\bsigned\b/gi, ' ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim());
}

function templateDescription(item) {
  const story = safeStory(item);
  const notes = item.condition_notes.length ? ` Worth knowing: ${item.condition_notes.join('; ')}.` : '';
  const paras = [];
  if (story) paras.push(`From the seller: "${story}"`);
  paras.push(`${GRADE_WORDS[item.grade] || GRADE_WORDS.B}${notes}`);
  return { title: [item.label, item.size ? `size ${item.size}` : ''].filter(Boolean).join(', '), body: paras.join('\n\n'), proof_line: null };
}

async function descriptionFor(item) {
  const ci = item.meta.demo || item.meta.cache_graded ? demoItem(item.meta.demo_key) : null;
  if (ci?.description?.body) return ci.description; // demo path: cache first, never waits on a model
  try {
    return await claude.writeDescription({
      label: item.label,
      brand: item.brand,
      size: item.size,
      type_label: item.meta.type_label || item.type,
      grade: item.grade,
      condition_notes: item.condition_notes,
      special: item.special,
      story: safeStory(item),
      proof_note: item.meta.proof_note || null,
      has_proof: showProof(item),
    });
  } catch (e) {
    warn(`Description fell back to the template (${e.message})`);
    return templateDescription(item);
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function descriptionHtml(item, desc) {
  const paras = String(desc.body || '')
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (item.claim && item.claim_proof) paras.push(claimLine(item));
  if (showProof(item)) paras.push(desc.proof_line || proofLine(item));
  const url = `${config.uiBase}/offer/${item.id}`;
  return [...paras.map((p) => `<p>${esc(p)}</p>`), `<p>Want it cheaper? Make an offer: <a href="${esc(url)}">${esc(url)}</a></p>`].join('\n');
}

function listingImages(item) {
  const urls = [...item.photos, item.claim_proof, ...(showProof(item) ? item.seller_proof : [])].filter(isUrl);
  return [...new Set(urls)].slice(0, 20);
}

async function pushToShopify(item) {
  if (!has.shopify()) return false;
  const desc = item.meta.listing_desc || templateDescription(item);
  try {
    const r = await shopify.createProduct({
      itemId: item.id,
      title: safeTitle(item, desc.title || item.label),
      descriptionHtml: descriptionHtml(item, desc),
      images: listingImages(item),
      price: item.list_price,
      tags: ['offload', item.brand, item.type, item.grade && `grade-${item.grade}`].filter(Boolean),
    });
    if (gone(item)) return false;
    Object.assign(item.meta, {
      shopify_product_id: r.productId,
      shopify_variant_id: r.variantId,
      shopify_handle: r.handle,
      shopify_failed: false,
    });
    item.shopify_url = r.url || null;
    save('items', item);
    return true;
  } catch (e) {
    warn(`Shopify listing failed for ${item.id} (${e.message})`);
    if (gone(item)) return false;
    item.meta.shopify_failed = true;
    save('items', item);
    return false;
  }
}

function listingWarnings(item) {
  const p = priceItem({ type: item.type, brand_tier: item.meta.brand_tier, grade: item.grade, special: item.special, seller_ask: item.seller_ask, comps: item.comps });
  if (p.askAboveMarket && !item.meta.comps_warned) {
    item.meta.comps_warned = true;
    event('agent', `Similar ones sell around ${gbp(Math.round(p.raw / 100) * 100)}. Listed ${the(item)} at your ${gbp(item.seller_ask)} anyway, I'll tell you if it's slow.`);
  }
  if (item.claim && !item.claim_proof && !item.meta.claim_off_told) {
    item.meta.claim_off_told = true;
    event('agent', `Kept "${item.claim}" off the listing for ${the(item)}. There's no clear close-up of ${item.meta.claim_noun || 'it'} yet, and we only say what buyers can see.`);
  }
  save('items', item);
}

const listing = new Set(); // item ids with a listing in flight; memory only, so a restart can't leave one stuck

export async function listItem(item) {
  if (listing.has(item.id) || item.status !== 'photographed') return item;
  listing.add(item.id);
  try {
    item.meta.listing_desc = await descriptionFor(item);
    if (gone(item)) return item;
    await pushToShopify(item);
    if (gone(item)) return item;
    item.status = 'listed';
    save('items', item);
    const slow = has.shopify() && !item.shopify_url ? " Shopify's being slow, I'll keep trying." : '';
    event('agent', `Listed ${the(item)} at ${gbp(item.list_price)}.${slow}`);
    listingWarnings(item);
  } finally {
    listing.delete(item.id);
  }
  return item;
}

// Overlapping handovers (runner's tap and the demo's S) share one run, so nothing lists twice or posts a false "nothing ready".
const handovers = new Map(); // pickupId -> in-flight handover promise
export function handover(pickup) {
  let p = handovers.get(pickup.id);
  if (!p) {
    p = runHandover(pickup).finally(() => handovers.delete(pickup.id));
    handovers.set(pickup.id, p);
  }
  return p;
}

async function runHandover(pickup) {
  const items = itemsOf(pickup.id);
  for (const it of items) {
    if (it.status === 'needs_photos') event('agent', `Holding back ${the(it)} until the runner sends ${it.meta.request_summary || 'better photos'}.`);
    else if (it.status === 'estimated') event('agent', `Holding back ${the(it)} until it's photographed.`);
  }
  await Promise.all(items.filter((i) => i.status === 'photographed').map((i) => listItem(i).catch((e) => warn(`Listing failed: ${e.message}`))));
  if (gone(pickup, 'pickups')) return pickup;
  const anyListed = items.some((i) => ['listed', 'offer', 'sold', 'posted'].includes(i.status));
  if (anyListed) {
    if (pickup.status !== 'listed') {
      pickup.status = 'listed';
      save('pickups', pickup);
    }
  } else event('agent', "Nothing's ready to list yet. Waiting on the runner's photos.");
  return pickup;
}

// Retries listings Shopify refused, every 30 s.
export function startShopifyRetry() {
  if (!has.shopify()) return;
  setInterval(async () => {
    for (const it of state.items) {
      if (!it.meta?.shopify_failed || listing.has(it.id) || !['listed', 'offer'].includes(it.status)) continue;
      listing.add(it.id);
      const ok = await pushToShopify(it).finally(() => listing.delete(it.id));
      if (ok) event('agent', `${cap(the(it))} is live on Shopify now.`);
    }
  }, 30000).unref();
}

// ---------- seller price and proof ----------

export async function setAsk(item, rawAsk) {
  const ask = toPence(rawAsk); // null clears it
  item.seller_ask = ask;
  item.meta.comps_warned = false;
  const p = applyPrice(item);
  save('items', item);
  const pickup = find('pickups', item.pickup_id);
  if (pickup) refreshPreview(pickup);
  event('seller', ask ? `${sellerOf(item)} set ${gbp(ask)} for ${the(item)}.` : `${sellerOf(item)} took their price off ${the(item)}.`);

  if (['listed', 'offer'].includes(item.status)) {
    if (item.meta.shopify_variant_id) {
      try {
        await shopify.updatePrice({ productId: item.meta.shopify_product_id, variantId: item.meta.shopify_variant_id, price: item.list_price });
      } catch (e) {
        warn(`Shopify price update failed (${e.message})`);
      }
    }
    event('agent', ask ? `Updated the listing to ${gbp(item.list_price)}.` : `Back to market pricing: ${the(item)} is now ${gbp(item.list_price)}.`);
    listingWarnings(item);
  } else if (p.askAboveMarket) {
    item.meta.comps_warned = true;
    save('items', item);
    event('agent', `Similar ones sell around ${gbp(Math.round(p.raw / 100) * 100)}. I'll list ${the(item)} at your ${gbp(ask)} anyway and tell you if it's slow.`);
  }
  return item;
}

export async function addProof(item, photos_b64, note) {
  const urls = photos_b64.length ? await storePhotos(photos_b64, `proof/${item.id}`) : [];
  item.seller_proof.push(...urls);
  item.proof_request = null;
  if (note) item.meta.proof_note = clip(String(note).trim(), 500);
  save('items', item);
  event('seller', `${sellerOf(item)} sent proof for ${the(item)}.`);
  if (item.meta.shopify_product_id && showProof(item)) {
    shopify
      .updateProduct({
        productId: item.meta.shopify_product_id,
        descriptionHtml: descriptionHtml(item, item.meta.listing_desc || templateDescription(item)),
        images: urls.filter(isUrl),
      })
      .catch((e) => warn(`Shopify proof update failed (${e.message})`));
  }
  return item;
}

// ---------- offers and sales ----------

const LIVE_OFFER = ['pending', 'countered', 'accepted'];

// A real Shopify code or null; never a made-up one.
async function discountCode(item, off) {
  if (!has.shopify() || !item.meta.shopify_product_id) return null;
  const code = `OFFLOAD-${item.id.slice(-4).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  try {
    const r = await shopify.createDiscountCode({ code, productId: item.meta.shopify_product_id, amountOff: off, title: `Offer on ${item.label}` });
    return r?.code || code;
  } catch (e) {
    warn(`Discount code failed (${e.message})`);
    return null;
  }
}

export async function makeOffer({ item, amount, buyer }) {
  const who = clip(String(buyer || '').trim(), 60) || 'A buyer';
  const round = state.offers.some((o) => o.item_id === item.id && o.buyer === who) ? 2 : 1;
  const offer = { id: id('o'), item_id: item.id, buyer: who, amount, counter: null, round, status: 'pending', discount_code: null };

  if (['sold', 'posted'].includes(item.status)) {
    offer.status = 'rejected';
    add('offers', offer);
    event('buyer', `${who} offered ${gbp(amount)} for ${the(item)}, but it's already sold.`);
    return offer;
  }

  if (amount >= item.floor_price) {
    const off = item.list_price - amount;
    offer.status = 'accepted';
    if (off < 0) offer.amount = item.list_price; // an offer over the price agrees the price
    if (off > 0) offer.discount_code = await discountCode(item, off);
    if (gone(item)) return offer;
    add('offers', offer);
    item.status = 'offer';
    save('items', item);
    if (off <= 0) event('buyer', `${who} offered the full ${gbp(item.list_price)} for ${the(item)}. Accepted.`, item.list_price);
    else if (offer.discount_code) event('buyer', `${who} offered ${gbp(amount)} for ${the(item)}. Accepted, code ${offer.discount_code} takes ${gbp(off)} off.`, amount);
    else if (!item.meta.shopify_product_id) event('buyer', `${who} offered ${gbp(amount)} for ${the(item)}. Accepted. It isn't on the shop yet, so there's no code to send.`, amount);
    else event('buyer', `${who} offered ${gbp(amount)} for ${the(item)}. Accepted, but Shopify didn't give me a code just now.`, amount);
    return offer;
  }

  if (round === 1) {
    offer.status = 'countered';
    offer.counter = counterOffer({ amount, list_price: item.list_price, floor_price: item.floor_price });
    add('offers', offer);
    item.status = 'offer';
    save('items', item);
    event('buyer', `${who} offered ${gbp(amount)} for ${the(item)}. Countered at ${gbp(offer.counter)}.`);
    return offer;
  }

  offer.status = 'rejected';
  const othersLive = state.offers.some((o) => o.item_id === item.id && o.buyer !== who && LIVE_OFFER.includes(o.status));
  add('offers', offer);
  if (item.status === 'offer' && !othersLive) {
    item.status = 'listed';
    save('items', item);
  }
  event('buyer', `${who} came back at ${gbp(amount)} for ${the(item)}. That's below what the seller will take, so I said a polite no.`);
  return offer;
}

export function recordSale(item, salePrice, { shipTo = null, orderId = null } = {}) {
  if (['sold', 'posted'].includes(item.status) || state.ledger.some((l) => l.item_id === item.id)) return null;
  const sale = Math.round(salePrice);
  item.status = 'sold';
  if (orderId) item.meta.order_id = orderId;
  save('items', item);
  const row = { id: id('l'), item_id: item.id, ...split(sale) };
  add('ledger', row);
  if (item.meta?.shopify_product_id) {
    // One-off item: show it sold out so nobody else can buy it.
    shopify
      .markSold({ productId: item.meta.shopify_product_id, variantId: item.meta.shopify_variant_id })
      .catch((e) => warn(`Shopify sold-out update failed (${e.message})`));
  }
  const pickup = find('pickups', item.pickup_id);
  // "Books the runner to post it": the runner who collected the pile already holds the item.
  const runner = pickup?.runner_name || null;
  add('jobs', {
    id: id('j'),
    type: 'post',
    pickup_id: item.pickup_id,
    item_ids: [item.id],
    runner_name: runner,
    address: shipTo ? `Post to ${shipTo}` : 'Post to the buyer (address on the Shopify order)',
    pay: POST_JOB_PAY,
    status: runner ? 'accepted' : 'open',
  });
  event('agent', `Sold ${the(item)} for ${gbp(sale)}. ${pickup?.seller_name || 'Seller'} gets ${gbp(row.seller_amount)}.`, sale);
  event('agent', `Booked ${runner || 'a runner'} to post ${the(item)}.`);
  return row;
}

// Called by the Shopify order poller for every new order.
export function onOrder(order) {
  for (const line of order.lines || []) {
    const item = state.items.find(
      (i) => i.meta && ((line.productId && i.meta.shopify_product_id === line.productId) || (line.variantId && i.meta.shopify_variant_id === line.variantId)),
    );
    if (!item) continue;
    const qty = line.quantity > 1 ? line.quantity : 1;
    const row = recordSale(item, Math.round(line.salePrice / qty), { shipTo: order.shipTo, orderId: order.orderId });
    // A second order for a one-off item that already sold through another order. A sale recorded without an
    // order id may be the demo's own order arriving late, so that case stays quiet.
    if (!row && ['sold', 'posted'].includes(item.status) && item.meta.order_id && item.meta.order_id !== order.orderId) {
      event('agent', `Order ${order.name} came in for ${the(item)}, but it's already sold. That one needs a refund.`);
    }
  }
}
