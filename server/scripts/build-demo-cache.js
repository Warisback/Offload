// Rebuilds cache/demo.json from the real demo pile (photos + short videos filmed at the venue), using the
// production pipeline: the brain estimates from frames + transcript, grades each item from its photos, Tavily
// finds comps, descriptions are written, and every photo is uploaded to Supabase Storage.
// Usage (from server/): node scripts/build-demo-cache.js <pile dir>
//   <pile dir> holds photo1..4.jpg, v1..v3/ fNN.jpg frames and transcripts.json (made by the prep step).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { prepareImage, sample } from '../src/images.js';
import * as claude from '../src/claude.js';
import * as comps from '../src/comps.js';
import * as storage from '../src/storage.js';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node scripts/build-demo-cache.js <pile dir>');
const read = (p) => fs.readFileSync(path.join(dir, p));
const frames = (v) => fs.readdirSync(path.join(dir, v)).filter((f) => f.endsWith('.jpg')).sort().map((f) => `${v}/${f}`);
const tx = JSON.parse(read('transcripts.json'));

// Which media belong to which item (the videos are one item each; photo1 is the jeans).
const MEDIA = [
  { key: 'crochet-denim', words: ['crochet', 'granny'], files: ['photo4.jpg', ...pickFrames('v1', [1, 6, 10, 13])], story: tx.v1 },
  { key: 'patch-jacket', words: ['patch'], files: ['photo3.jpg', ...pickFrames('v2', [1, 8, 13])], story: tx.v2, retake: pickFrames('v2', [5])[0] },
  { key: 'ralph-bomber', words: ['ralph', 'check', 'plaid', 'bomber'], files: ['photo2.jpg', ...pickFrames('v3', [1, 6, 8, 12])], story: tx.v3 },
  { key: 'adidas-jeans', words: ['jean', 'adidas', 'denim trousers'], files: ['photo1.jpg'], story: null },
];
function pickFrames(v, idx) {
  const all = frames(v);
  return idx.map((i) => all[Math.min(all.length - 1, i - 1)]);
}

const transcript = [tx.v1, tx.v2, tx.v3].join(' ');
const load = async (f) => prepareImage(read(f), { maxEdge: 1280, quality: 82 });

// One estimate per item: each video is one garment with its own words, so claims and asks can't bleed across.
async function estimateOne(m) {
  const imgs = [];
  for (const f of m.files.slice(0, 4)) imgs.push(await load(f));
  const r = await claude.estimatePile({ frames: imgs, transcript: m.story || '(no speech, photo only)', sellerName: 'Maya' });
  return r.items[0];
}
const est = { items: [] };
for (const m of MEDIA) {
  const e = await estimateOne(m);
  est.items.push(e);
  console.log(`${m.key}: ${e.label} [${e.type}, ${e.brand_tier}] q="${e.search_query}"${e.claim ? ' claim: ' + e.claim : ''}${e.seller_ask ? ' ask ' + e.seller_ask : ''}`);
}
const used = new Set();
const out = [];
for (const m of MEDIA) {
  const hay = (i) => `${i.label} ${i.brand || ''} ${i.type_label || ''}`.toLowerCase();
  const est1 = est.items[MEDIA.indexOf(m)];
  if (est1) used.add(est.items.indexOf(est1));
  const e = est1 || { label: m.key, type: 'other', brand_tier: 'unknown', condition_notes: [] };

  console.log(`\n${m.key}: uploading ${m.files.length} photos`);
  const imgs = [];
  const urls = [];
  for (const [n, f] of m.files.entries()) {
    const p = await load(f);
    imgs.push({ data: p.data, mediaType: p.mediaType });
    urls.push(await storage.uploadBuffer(p.buffer, `demo/${m.key}/${String(n + 1).padStart(2, '0')}.jpg`, 'image/jpeg'));
  }
  let retake = null;
  if (m.retake) {
    const p = await load(m.retake);
    const u = await storage.uploadBuffer(p.buffer, `demo/${m.key}/retake-closeup.jpg`, 'image/jpeg');
    retake = { photo_requests: [`Get a close-up of the stitching on one of the patches, in good light`], request_summary: 'a close-up of the hand stitching', photos_after: [u], claim_proof: u };
  }

  const check = await claude.checkPhotos({
    item: { label: e.label, brand: e.brand, type: e.type, size: e.size, claim: e.claim, claim_noun: e.claim_noun, condition_notes: e.condition_notes || [], seller_story: m.story || e.seller_story, special: e.special },
    photos: imgs,
    lenient: true,
  });
  const item = { label: e.label, brand: check.brand || e.brand, size: check.size || e.size, type: e.type, meta: { type_label: e.type_label, search_query: e.search_query } };
  const found = await comps.fetchComps(item);
  const story = e.seller_story || m.story || null;
  const desc = await claude.writeDescription({
    label: e.label, brand: item.brand, size: item.size, type_label: e.type_label, grade: check.grade,
    condition_notes: check.condition_notes, special: check.special || e.special, story: e.claim ? e.story_safe || story : story, proof_note: null, has_proof: false,
  });
  out.push({
    key: m.key,
    match: m.words.slice(0, 1),
    label: e.label, brand: item.brand || null, type: e.type, type_label: e.type_label || e.type, size: item.size || null, brand_tier: e.brand_tier,
    seller_story: story, story_safe: e.story_safe || null, claim: e.claim || null, claim_noun: e.claim_noun || null, claim_line: e.claim_line || null,
    seller_ask: e.seller_ask || null, proof_request: e.proof_request || null, search_query: e.search_query || item.label,
    estimate_notes: e.condition_notes || [],
    grade: check.grade, condition_notes: check.condition_notes || [], special: check.special || e.special || null,
    photos: urls, claim_proof: e.claim && !retake ? (urls[check.claim_proof_index] || null) : null,
    retake,
    comps: found,
    description: { title: desc.title, body: desc.body, proof_line: desc.proof_line || null },
  });
  console.log(`  grade ${check.grade}, ${found.length} comps, special: ${check.special || '-'}`);
}

const file = path.join(ROOT, 'cache', 'demo.json');
const old = JSON.parse(fs.readFileSync(file, 'utf8'));
fs.writeFileSync(path.join(ROOT, 'cache', 'demo.previous.json'), JSON.stringify(old, null, 2));
const sale = out.find((i) => i.key === 'ralph-bomber');
const next = {
  seller_name: old.seller_name || 'Maya',
  address: old.address,
  runner_name: old.runner_name || 'Sam',
  transcript,
  items: out,
  sale: { item_key: sale.key, buyer: 'Grok Bot', first_offer: null, discount_code: null },
};
fs.writeFileSync(file, JSON.stringify(next, null, 2));
console.log(`\nWrote ${file} (${out.length} items). Previous cache saved as cache/demo.previous.json`);
process.exit(0);
