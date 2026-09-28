// Uploads real photos of the demo pile to Supabase Storage and points cache/demo.json at them.
//
// How to use:
//   1. Put photos in server/cache/photos/<item key>/. The keys are in cache/demo.json
//      (levis-trucker, nike-crewneck, kobe-jersey, painted-denim, wool-jumper, st-michael-dress):
//        cache/photos/levis-trucker/01-front.jpg, 02-back.jpg, 03-label.jpg, 04-buttons.jpg
//      - Photos show in filename order, so number them. jpg, jpeg, png or webp.
//      - Big phone photos are fine: each is turned into a 1600px JPEG before upload.
//      - A file with "claim" or "signature" in its name is the close-up of the claim. It becomes
//        claim_proof and stays in photos too (e.g. 03-painted-claim.jpg).
//      - Files in cache/photos/<key>/retake/ become retake.photos_after (the runner's second go).
//        One with "claim" or "signature" in its name becomes retake.claim_proof.
//   2. Put SUPABASE_URL and SUPABASE_SERVICE_KEY in server/.env and run schema.sql once (it makes the public bucket).
//   3. From server/:  node scripts/upload-demo-photos.js           (--dry-run shows the plan without uploading)
//   4. Check it with  node scripts/validate.js --cache  and restart the server (the cache is read at boot).
//
// Only items that have a folder change. Everything else in demo.json stays as it was,
// and the previous version is kept in cache/demo.json.bak.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, has } from '../src/config.js';
import { prepareImage } from '../src/images.js';

const CACHE_FILE = path.join(ROOT, 'cache', 'demo.json');
const PHOTOS_DIR = path.join(ROOT, 'cache', 'photos');
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const CLAIM_RE = /claim|signature/i;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const slug = (file) => path.parse(file).name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'photo';

function imagesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && IMAGE_RE.test(d.name))
    .map((d) => d.name)
    .sort(byName);
}

function folders() {
  if (!fs.existsSync(PHOTOS_DIR)) return [];
  return fs
    .readdirSync(PHOTOS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort(byName);
}

// One file -> public URL. The run stamp keeps paths unique, so a re-run never serves a stale cached image.
async function uploadOne(uploadBuffer, dir, file, remotePath) {
  const img = await prepareImage(fs.readFileSync(path.join(dir, file)), { maxEdge: 1600, quality: 82 });
  const ext = EXT[img.mediaType] || 'jpg';
  return uploadBuffer(img.buffer, `${remotePath}.${ext}`, img.mediaType);
}

async function uploadItem(uploadBuffer, key, main, retake, stamp) {
  const dir = path.join(PHOTOS_DIR, key);
  const photos = await Promise.all(main.map((f, i) => uploadOne(uploadBuffer, dir, f, `demo/${key}/${stamp}-${i + 1}-${slug(f)}`)));
  const after = await Promise.all(
    retake.map((f, i) => uploadOne(uploadBuffer, path.join(dir, 'retake'), f, `demo/${key}/${stamp}-retake-${i + 1}-${slug(f)}`)),
  );
  return { photos, after };
}

// Applies the uploaded URLs to one cache item. Returns short notes for the summary.
function apply(ci, main, retake, urls) {
  const notes = [];
  if (main.length) {
    ci.photos = urls.photos;
    const k = main.findIndex((f) => CLAIM_RE.test(f));
    ci.claim_proof = k >= 0 ? urls.photos[k] : null;
    if (ci.claim && !ci.claim_proof && !ci.retake) notes.push('no "claim" file, so the claim stays off the listing');
  }
  if (retake.length) {
    const k = retake.findIndex((f) => CLAIM_RE.test(f));
    ci.retake.photos_after = urls.after;
    ci.retake.claim_proof = urls.after[k >= 0 ? k : 0];
    if (k < 0) notes.push(`no "claim" file in retake/, used ${retake[0]} as the close-up`);
  }
  return notes;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/upload-demo-photos.js [--dry-run]\nSee the comment at the top of this file for the folder layout.');
    return;
  }
  const dry = args.includes('--dry-run');
  const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  const keys = cache.items.map((ci) => ci.key);

  const found = folders();
  if (!found.length) {
    console.log(`No photo folders in server/cache/photos/. Make one per item, named by key:\n  ${keys.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  if (!dry && !has.supabase()) {
    console.log('Supabase isn\'t configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in server/.env, or use --dry-run.');
    process.exitCode = 1;
    return;
  }
  const storage = dry ? null : await import('../src/storage.js');
  const uploadBuffer = storage?.uploadBuffer;
  if (storage) await storage.ensureBucket(); // makes the public bucket if schema.sql wasn't run; never throws

  const stamp = Date.now().toString(36);
  const rows = [];
  let changed = 0;
  let failed = 0;

  for (const key of found) {
    const ci = cache.items.find((x) => x.key === key);
    if (!ci) {
      rows.push([key, '-', '-', '-', `skipped: no item with this key (keys: ${keys.join(', ')})`]);
      continue;
    }
    const main = imagesIn(path.join(PHOTOS_DIR, key));
    let retake = imagesIn(path.join(PHOTOS_DIR, key, 'retake'));
    const notes = [];
    if (retake.length && !ci.retake) {
      notes.push('retake/ ignored: this item has no retake in demo.json');
      retake = [];
    }
    if (!main.length && !retake.length) {
      rows.push([key, '-', '-', '-', ['skipped: no jpg, png or webp files', ...notes].join('; ')]);
      continue;
    }
    const claimFile = main.find((f) => CLAIM_RE.test(f));
    if (dry) {
      const plan = [`${main.length} photos${claimFile ? `, claim: ${claimFile}` : ''}`, retake.length ? `retake: ${retake.join(', ')}` : ''];
      rows.push([key, main.length || 'kept', claimFile ? 'yes' : '-', retake.length || '-', ['would upload', ...plan.filter(Boolean), ...notes].join('; ')]);
      continue;
    }
    try {
      const urls = await uploadItem(uploadBuffer, key, main, retake, stamp);
      notes.push(...apply(ci, main, retake, urls));
      changed++;
      rows.push([key, main.length || 'kept', ci.claim_proof ? 'yes' : '-', retake.length || '-', ['uploaded', ...notes].join('; ')]);
    } catch (e) {
      failed++;
      rows.push([key, '-', '-', '-', `FAILED, left as it was (${e.message})`]);
    }
  }

  const missing = keys.filter((k) => !found.includes(k));

  console.log(`\n${dry ? 'Dry run' : 'Upload'}: cache/photos -> Supabase ${dry ? '(nothing sent)' : `bucket, folder demo/<key>/`}`);
  console.log(`  ${'item'.padEnd(18)} ${'photos'.padEnd(7)} ${'claim'.padEnd(6)} ${'retake'.padEnd(7)} result`);
  for (const r of rows) console.log(`  ${String(r[0]).padEnd(18)} ${String(r[1]).padEnd(7)} ${String(r[2]).padEnd(6)} ${String(r[3]).padEnd(7)} ${r[4]}`);
  if (missing.length) console.log(`  No folder (kept as they were): ${missing.join(', ')}`);

  if (!dry && changed) {
    fs.copyFileSync(CACHE_FILE, `${CACHE_FILE}.bak`);
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2) + '\n');
    console.log(`\nUpdated cache/demo.json (${changed} item${changed === 1 ? '' : 's'}). Old version: cache/demo.json.bak`);
    console.log('Next: node scripts/validate.js --cache, then restart the server.');
  } else if (!dry) {
    console.log('\ncache/demo.json not changed.');
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`upload-demo-photos: ${e.message}`);
  process.exitCode = 1;
});
