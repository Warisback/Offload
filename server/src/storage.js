// Supabase Storage uploads -> public URLs (Shopify and the UI load photos straight from the bucket).
import { config } from './config.js';
import { supabase } from './db.js';
import { prepareImage } from './images.js';
import { log, warn, withTimeout } from './util.js';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function client() {
  if (!supabase) throw new Error('not configured');
  return supabase;
}

const rand = () => Math.random().toString(36).slice(2, 8);

async function put(buffer, path, contentType) {
  const bucket = client().storage.from(config.bucket);
  const { error } = await bucket.upload(path, buffer, { contentType, upsert: true, cacheControl: '31536000' });
  if (error) throw new Error(`upload ${path} failed: ${error.message}`);
  return bucket.getPublicUrl(path).data.publicUrl;
}

export async function uploadBuffer(buffer, path, contentType = 'image/jpeg') {
  try {
    return await withTimeout(put(buffer, path, contentType), config.timeouts.storage, 'storage upload');
  } catch (e) {
    warn('storage:', e.message);
    throw e;
  }
}

// Resizes each image, uploads them in parallel and returns public URLs in input order.
// One failure fails the whole call; the caller decides the fallback.
export async function uploadImages(b64List, folder) {
  try {
    client();
    const list = Array.isArray(b64List) ? b64List : [];
    const dir = String(folder ?? '').replace(/^\/+|\/+$/g, '') || 'misc';
    const stamp = Date.now();
    const jobs = list.map(async (entry, i) => {
      const img = await prepareImage(entry, { maxEdge: 1600, quality: 82 });
      return put(img.buffer, `${dir}/${stamp}-${i}-${rand()}.${EXT[img.mediaType] || 'jpg'}`, img.mediaType);
    });
    return await withTimeout(Promise.all(jobs), config.timeouts.storage, 'storage upload');
  } catch (e) {
    warn('storage:', e.message);
    throw e;
  }
}

// Supabase answers a missing bucket with 400 + statusCode "404" (older) or a plain 404.
const isNotFound = (error) =>
  error?.status === 404 || String(error?.statusCode) === '404' || /not\s*found/i.test(error?.message || '');

async function checkBucket() {
  const storage = client().storage;
  const { data, error } = await storage.getBucket(config.bucket);
  if (data) {
    if (!data.public) {
      warn(`storage: bucket "${config.bucket}" is PRIVATE. Photo URLs will not load in Shopify or the UI. Make it public in Supabase > Storage.`);
    }
    return;
  }
  if (!isNotFound(error)) throw new Error(`bucket check failed: ${error?.message || 'unknown error'}`);
  const created = await storage.createBucket(config.bucket, { public: true });
  if (created.error && !/exist|duplicate/i.test(created.error.message || '')) {
    throw new Error(`could not create bucket: ${created.error.message}`);
  }
  if (!created.error) log(`storage: created public bucket "${config.bucket}"`);
}

// Boot-time check. Never throws.
export async function ensureBucket() {
  if (!supabase) return;
  try {
    await withTimeout(checkBucket(), config.timeouts.storage, 'storage bucket check');
  } catch (e) {
    warn('storage:', e.message);
  }
}
