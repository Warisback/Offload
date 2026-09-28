// Tavily search -> priced comps from public marketplace listings. Search results only: no logins, no scraping.
import { config, has } from './config.js';
import { clip, warn, TimeoutError } from './util.js';

const ENDPOINT = 'https://api.tavily.com/search';

// UK marketplaces only: with ebay.com in the list results came back mostly in dollars. Tested live: UK list +
// a 'price £' query + country gave 8/10 priced results in £ versus 2/10 before.
export const SOURCE_DOMAINS = [
  'ebay.co.uk',
  'depop.com',
  'vestiairecollective.com',
  'marketplace.asos.com',
];

// Rough rates are fine: comps only need the right ballpark.
const TO_GBP = { GBP: 1, USD: 0.78, EUR: 0.86 };
const MIN_PENCE = 200; // £2
const MAX_PENCE = 500000; // £5000

// Prefix form ("£45", "US $59.99", "GBP 45") or suffix form ("120,00 €", "45 GBP").
// The suffix form refuses a currency followed by a digit, so "Size 10 £45" reads as £45, not £10.
const PRICE_RE = /(\bUS\s?\$|\bUSD|\bGBP|\bEUR|£|€|\$)\s?(\d[\d.,]*)|(\d[\d.,]*)\s?(£|€|(?:GBP|EUR)\b)(?!\s?\d)/gi;

// Amounts that are postage, or an old/retail price, rather than what the item sells for.
const SECONDARY_AFTER = /^\s*(?:(?:uk|standard|express|tracked|economy|international)\s+)?(?:postage|delivery|shipping|p\s?&\s?p)\b/i;
const SECONDARY_BEFORE =
  /\b(?:postage|delivery|shipping|p\s?&\s?p|packaging|was|rrp|retail(?:\s+price)?|originally)\s*(?:costs?|fee|from|of|is)?\s*[:\-–]?\s*\+?\s*$/i;

// Other dollars ("C $45", "AU $80") are skipped rather than guessed.
const OTHER_DOLLAR = /\b(?:C|CA|AU|NZ|HK|SG)\s?$/i;

const SITE_SUFFIX = /\s*[|\-–]\s*(?:ebay(?:\s?uk)?|depop|vestiaire collective|asos marketplace|asos)\s*$/i;

function currencyOf(token) {
  const t = token.toUpperCase().replace(/\s/g, '');
  if (t === '£' || t === 'GBP') return 'GBP';
  if (t === '€' || t === 'EUR') return 'EUR';
  return 'USD';
}

// "1,200" -> 1200, "45.00" -> 45, "120,00" -> 120, "1.200,50" -> 1200.5 (the last separator decides)
function toAmount(raw, currency) {
  const s = raw.replace(/[.,]+$/, '');
  if (!s) return null;
  const dot = s.lastIndexOf('.');
  const comma = s.lastIndexOf(',');
  let plain = s;
  if (dot >= 0 && comma >= 0) {
    const at = Math.max(dot, comma);
    plain = s.slice(0, at).replace(/[.,]/g, '') + '.' + s.slice(at + 1);
  } else if (dot >= 0 || comma >= 0) {
    const parts = s.split(comma >= 0 ? ',' : '.');
    const tail = parts.at(-1);
    // A single 3-digit group after "," is thousands; after "." only for euros ("€1.200").
    const thousands = parts.length > 2 || (tail.length === 3 && (comma >= 0 || currency === 'EUR'));
    plain = thousands ? parts.join('') : parts.slice(0, -1).join('') + '.' + tail;
  }
  const n = Number(plain);
  return Number.isFinite(n) ? n : null;
}

function* candidates(text) {
  if (typeof text !== 'string' || !text) return;
  for (const m of text.matchAll(PRICE_RE)) {
    const token = m[1] ?? m[4];
    const raw = m[2] ?? m[3];
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    if (token === '$' && OTHER_DOLLAR.test(before)) continue;
    const currency = currencyOf(token);
    const amount = toAmount(raw, currency);
    if (amount == null) continue;
    const pence = Math.round(amount * TO_GBP[currency] * 100);
    if (pence < MIN_PENCE || pence > MAX_PENCE) continue;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
    yield { pence, secondary: SECONDARY_BEFORE.test(before) || SECONDARY_AFTER.test(after) };
  }
}

// Integer pence in GBP, or null. Pass the title first, then the snippet: the first clean price wins,
// and a postage/was/RRP amount is only used when nothing else was found.
export function parsePrice(...texts) {
  let fallback = null;
  for (const text of texts) {
    for (const c of candidates(text)) {
      if (!c.secondary) return c.pence;
      fallback ??= c.pence;
    }
  }
  return fallback;
}

function sourceOf(hostname) {
  const host = hostname.toLowerCase().replace(/^(?:www|m)\./, '');
  if (/(?:^|\.)ebay\.(?:co\.uk|com)$/.test(host)) return 'eBay';
  if (/(?:^|\.)depop\.com$/.test(host)) return 'Depop';
  if (host === 'marketplace.asos.com') return 'ASOS Marketplace';
  if (/(?:^|\.)vestiairecollective\.com$/.test(host)) return 'Vestiaire Collective';
  return null;
}

// eBay item links drop their tracking query; the same item id on .com and .co.uk is one listing.
function normaliseUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const source = sourceOf(u.hostname);
  if (!source) return null;
  u.hash = '';
  const ebayItem = source === 'eBay' && u.pathname.includes('/itm/');
  if (ebayItem) u.search = '';
  const itemId = ebayItem && /\/itm\/(?:[^/]+\/)?(\d{9,})/.exec(u.pathname)?.[1];
  const key = itemId
    ? `ebay:${itemId}`
    : (u.hostname.replace(/^(?:www|m)\./, '') + u.pathname.replace(/\/+$/, '') + u.search).toLowerCase();
  return { source, url: u.toString(), key };
}

function toComps(results) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(results) ? results : []) {
    const link = normaliseUrl(r?.url);
    if (!link || seen.has(link.key)) continue;
    seen.add(link.key);
    const title = String(r.title ?? '').trim();
    const content = String(r.content ?? '').replace(/\s+/g, ' ').trim();
    out.push({
      source: link.source,
      title: title.replace(SITE_SUFFIX, '') || title,
      price: parsePrice(title, content),
      url: link.url,
      snippet: clip(content, 300),
    });
  }
  return out;
}

async function errorDetail(res) {
  try {
    const text = await res.text();
    const body = JSON.parse(text);
    // 401/429 send { detail: { error } }; 422 sends { detail: [{ loc, msg }] }.
    const first = Array.isArray(body?.detail) ? body.detail[0] : null;
    const field = first && Array.isArray(first.loc) ? `${first.loc.join('.')} ` : '';
    const msg = first ? `${field}${first.msg ?? ''}`.trim() : (body?.detail?.error ?? body?.detail ?? body?.error);
    return typeof msg === 'string' && msg ? `: ${clip(msg, 120)}` : '';
  } catch {
    return '';
  }
}

async function post(body, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms); // cleared in finally, so it never outlives the request
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.tavilyKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}${await errorDetail(res)}`);
    return await res.json();
  } catch (e) {
    const err = ctrl.signal.aborted ? new TimeoutError('tavily search', ms) : e;
    warn('tavily:', err.message);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// -> [{ source, title, price /*pence|null*/, url, snippet }] in Tavily's relevance order, deduped by url.
export async function searchComps(query, { timeoutMs } = {}) {
  if (!has.tavily()) throw new Error('not configured');
  const q = String(query ?? '').trim();
  if (!q) throw new Error('empty query');
  const data = await post(
    {
      query: q.includes('£') ? q : `${q} price £`,
      search_depth: 'basic',
      country: 'united kingdom',
      max_results: 10,
      include_domains: SOURCE_DOMAINS,
      include_answer: false,
      include_raw_content: false,
    },
    timeoutMs > 0 ? timeoutMs : config.timeouts.tavily,
  );
  return toComps(data?.results);
}
