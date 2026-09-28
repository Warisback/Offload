// Price comparisons: cache first, then Tavily search, then Claude keeps only the close matches.
// Returns comps as [{ source, title, price, url }] best-first; [] is an honest "nothing like it online".
import { config, has } from './config.js';
import * as tavily from './tavily.js';
import * as claude from './claude.js';
import { median } from './pricing.js';
import { norm, withTimeout, warn, log } from './util.js';

const cache = new Map(); // norm(query) or "demo:<key>" -> comps
const pending = new Map();

export function queryFor(item) {
  const m = item.meta || {};
  const kind = m.type_label || item.type;
  if (item.brand) return [item.brand, kind, item.size ? `size ${item.size}` : ''].filter(Boolean).join(' ');
  return m.search_query || [kind, item.label].filter(Boolean).join(' ');
}

export function preload(key, comps) {
  if (key && Array.isArray(comps)) cache.set(key.startsWith('demo:') ? key : norm(key), comps);
}

// Cached comps for an item, or null when we haven't searched yet.
export function cached(item) {
  const key = item.meta?.demo_key;
  if (key && cache.has(`demo:${key}`)) return cache.get(`demo:${key}`);
  return cache.get(norm(queryFor(item))) ?? null;
}

const pick = (c) => ({ source: c.source, title: c.title, price: c.price, url: c.url });

// Plain fallback when Claude can't filter: same brand and same kind of item, outliers dropped.
function heuristic(candidates, item) {
  const brandWords = norm(item.brand).split(' ').filter((w) => w.length > 2);
  const kindWords = norm(item.meta?.type_label || item.type).split(' ').filter((w) => w.length > 2);
  let keep = candidates.filter((c) => {
    const t = norm(`${c.title} ${c.snippet || ''}`);
    const brandOk = !brandWords.length || brandWords.some((w) => t.includes(w));
    const kindOk = !kindWords.length || kindWords.some((w) => t.includes(w));
    return brandOk && kindOk;
  });
  const mid = median(keep.map((c) => c.price));
  if (mid) keep = keep.filter((c) => c.price <= mid * 3 && c.price >= mid / 3);
  return keep.slice(0, 5).map(pick);
}

async function search(item) {
  const q = queryFor(item);
  let found = await tavily.searchComps(q, { timeoutMs: config.timeouts.tavily });
  let priced = found.filter((c) => Number.isFinite(c.price) && c.price > 0);
  // Size often over-narrows vintage searches; try once without it.
  if (priced.length < 2 && item.brand && item.size) {
    const q2 = [item.brand, item.meta?.type_label || item.type].filter(Boolean).join(' ');
    found = await tavily.searchComps(q2, { timeoutMs: config.timeouts.tavily });
    priced = found.filter((c) => Number.isFinite(c.price) && c.price > 0);
  }
  if (!priced.length) return [];
  try {
    const { matches } = await claude.filterComps({
      query: q,
      item: { label: item.label, brand: item.brand, type_label: item.meta?.type_label || item.type, size: item.size },
      candidates: priced,
    });
    return (matches || [])
      .filter((m) => priced[m.index] && Number.isFinite(m.price) && m.price > 0)
      .slice(0, 5)
      .map((m) => ({ ...pick(priced[m.index]), price: Math.round(m.price) }));
  } catch (e) {
    warn(`Comps filter fell back to keyword match (${e.message})`);
    return heuristic(priced, item);
  }
}

// Searches once per query; concurrent callers share the same request. Never throws.
export function fetchComps(item) {
  const hit = cached(item);
  if (hit) return Promise.resolve(hit);
  if (!has.tavily()) return Promise.resolve([]);
  const key = norm(queryFor(item));
  if (pending.has(key)) return pending.get(key);
  const p = withTimeout(search(item), config.timeouts.tavily * 2 + config.timeouts.comps, 'comps')
    .then((comps) => {
      cache.set(key, comps);
      log(`Comps for "${queryFor(item)}": ${comps.length} close matches`);
      return comps;
    })
    .catch((e) => {
      warn(`Comps search failed for "${queryFor(item)}": ${e.message}`);
      return []; // not cached, so a later call can retry
    })
    .finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

// Starts searches in the background so comps are ready by the time photos arrive.
export function warm(items) {
  for (const it of items) if (!cached(it)) fetchComps(it);
}
