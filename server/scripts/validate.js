// Checks a GET /api/state payload against the CONTRACT in CLAUDE.md, plus the pricing rule and the money split.
//
//   node scripts/validate.js                          check mock/seed.json
//   node scripts/validate.js path/to/state.json       check a saved payload
//   node scripts/validate.js https://abc.ngrok.app    fetch <url>/api/state and check the live state
//   node scripts/validate.js --cache                  check cache/demo.json against the demo cache format (DESIGN.md)
//
// Errors break the contract and exit 1. Warnings are worth a look but never fail.
// Against a live server, history checks (offer maths, preview lines, event amounts) are warnings,
// because a seller can change their price after an offer was made.
// No dependencies and no imports from src/: the rule is restated here so a bug in pricing.js can't hide itself.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- the rule (CLAUDE.md "Pricing rule" and "Money split") ----------

const TYPE_BASE = { jacket: 3000, jeans: 2000, hoodie: 2000, 't-shirt': 800, dress: 2200, trainers: 3500, other: 1200 };
const TIER_MULT = { designer: 3, premium: 1.8, 'high street': 1, unknown: 0.7 };
const GRADE_MULT = { A: 1, B: 0.85, C: 0.65, D: 0.4 };
const SPECIAL_MULT = 1.2;
const FLOOR = 0.7;
const ASK_FLOOR = 0.8;
const SELLER_SHARE = 0.7;
const RUNNER_FEE = 600;

const TYPES = Object.keys(TYPE_BASE);
const TIERS = Object.keys(TIER_MULT);
const GRADES = Object.keys(GRADE_MULT);

const roundPounds = (p) => Math.max(100, Math.round(p / 100) * 100);

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

const compPrices = (comps) =>
  (Array.isArray(comps) ? comps : [])
    .map((c) => c?.price)
    .filter((p) => Number.isInteger(p) && p > 0)
    .slice(0, 5);

// grade null = assume B (items are priced before the runner's photos arrive)
const multOf = (grade, special) => (GRADE_MULT[grade] ?? GRADE_MULT.B) * (special ? SPECIAL_MULT : 1);

// Returns what the rule says, plus `exact` (before rounding) so we can flag values sitting on a .50 boundary.
function rulePrice({ type, tier, grade, special, seller_ask, comps }) {
  const prices = compPrices(comps);
  const raw = prices.length >= 2 ? median(prices) : null;
  const m = multOf(grade, special);
  const market = raw != null ? roundPounds(raw * m) : null;
  if (seller_ask) {
    const above = market != null && seller_ask >= market * 1.5;
    let confidence = 'medium';
    if (market != null) confidence = above ? 'low' : seller_ask <= market * 1.25 ? 'high' : 'medium';
    return { source: 'seller', list: seller_ask, floor: Math.round(seller_ask * ASK_FLOOR), confidence, raw, market, above };
  }
  if (raw != null) {
    const list = roundPounds(raw * m);
    return { source: 'comps', list, floor: Math.round(list * FLOOR), confidence: prices.length >= 4 ? 'high' : 'medium', raw, exact: raw * m };
  }
  if (!tier) return { source: 'table', list: null, floor: null, confidence: 'low', exact: null };
  const exact = TYPE_BASE[type] * TIER_MULT[tier] * m;
  const list = roundPounds(exact);
  return { source: 'table', list, floor: Math.round(list * FLOOR), confidence: 'low', exact };
}

function previewRange({ type, tier, special, seller_ask, comps }) {
  if (seller_ask) return { low: Math.round(seller_ask * ASK_FLOOR), high: seller_ask };
  const prices = compPrices(comps);
  const base = prices.length >= 2 ? median(prices) : tier ? TYPE_BASE[type] * TIER_MULT[tier] : null;
  if (base == null) return null;
  const s = special ? SPECIAL_MULT : 1;
  return { low: roundPounds(base * GRADE_MULT.C * s), high: roundPounds(base * GRADE_MULT.A * s) };
}

const counterFor = (amount, list, floor) => Math.min(list, Math.max(floor, Math.round((amount + list) / 2 / 100) * 100));

const onBoundary = (exact) => exact != null && Math.abs((exact % 100) - 50) < 0.5;

// Brand tier is not in the contract (it lives in item.meta), so infer it for table-priced items.
const TIER_BRANDS = {
  designer: [
    'gucci', 'prada', 'louis vuitton', 'burberry', 'versace', 'dior', 'balenciaga', 'saint laurent', 'yves saint laurent',
    'fendi', 'givenchy', 'moncler', 'comme des garcons', 'vivienne westwood', 'chanel', 'hermes', 'bottega veneta',
    'alexander mcqueen', 'valentino', 'celine', 'loewe', 'maison margiela', 'off white', 'dolce gabbana', 'armani',
  ],
  premium: [
    'ralph lauren', 'polo ralph lauren', 'carhartt', 'levi', "levi's", 'nike', 'adidas', 'harley davidson', 'patagonia',
    'the north face', 'north face', 'tommy hilfiger', 'lacoste', 'stussy', 'champion', 'barbour', 'dr martens',
    "arc'teryx", 'stone island', 'diesel', 'calvin klein', 'fila', 'umbro', 'kappa', 'new balance', 'timberland',
    'dickies', 'wrangler', 'lee', 'fred perry', 'hugo boss', 'columbia', 'reebok', 'puma', 'converse', 'vans',
    'supreme', 'belstaff', 'ellesse', 'sergio tacchini', 'schott', 'pendleton', 'woolrich', 'paul smith', 'ted baker',
    'allsaints', 'acne studios', 'apc', 'russell athletic', 'starter', 'mitchell ness', 'nautica', 'gant', 'guess',
    'moschino', 'kenzo', 'burton snowboards',
  ],
  'high street': [
    'zara', 'h m', 'topshop', 'topman', 'gap', 'uniqlo', 'm s', 'marks spencer', 'marks and spencer', 'st michael',
    'next', 'river island', 'primark', 'asos', 'new look', 'mango', 'bershka', 'pull bear', 'urban outfitters', 'monki',
    'weekday', 'miss selfridge', 'dorothy perkins', 'burton', 'bhs', 'matalan', 'george', 'f f', 'boohoo',
    'prettylittlething', 'missguided', 'warehouse', 'wallis', 'fat face', 'white stuff', 'joules', 'superdry',
    'jack jones', 'stradivarius', 'old navy', 'american eagle', 'hollister', 'abercrombie', 'cos',
  ],
};

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

function inferTier(brand) {
  if (brand == null || !String(brand).trim()) return 'unknown';
  const b = ` ${norm(brand)} `;
  for (const tier of ['designer', 'premium', 'high street']) {
    if (TIER_BRANDS[tier].some((k) => b.includes(` ${k} `) || b.startsWith(` ${k}'`))) return tier;
  }
  return null; // unknown to us, which is not the same as the 'unknown' tier
}

// ---------- tiny type checkers: return null (ok), 'error text', or { warn: 'text' } ----------

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
const URL_RE = /^https:\/\/[^\s/?#]+\.[^\s/?#]+(\/\S*)?$/;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

const isStr = (v) => typeof v === 'string';
const isPence = (v) => Number.isInteger(v) && v >= 0;

function urlCheck(v) {
  if (!isStr(v)) return 'must be a URL string';
  if (v.startsWith('data:image/')) return { warn: 'is an inline data URL (the Storage upload fell back), not a public URL' };
  if (!URL_RE.test(v)) return `must be a public https URL, got "${v.slice(0, 60)}"`;
  return null;
}

const T = {
  str: (v) => (isStr(v) ? null : 'must be a string'),
  text: (v) => (isStr(v) && v.trim() ? null : 'must be a non-empty string'),
  nstr: (v) => (v === null || isStr(v) ? null : 'must be a string or null'),
  pence: (v) => (isPence(v) ? null : `must be integer pence >= 0, got ${JSON.stringify(v)}`),
  npence: (v) => (v === null || (Number.isInteger(v) && v > 0) ? null : `must be integer pence > 0 or null, got ${JSON.stringify(v)}`),
  signedPence: (v) => (Number.isInteger(v) ? null : `must be integer pence, got ${JSON.stringify(v)}`),
  iso: (v) => (isStr(v) && ISO_RE.test(v) && Number.isFinite(Date.parse(v)) ? null : `must be an ISO timestamp, got ${JSON.stringify(v)}`),
  url: urlCheck,
  nurl: (v) => (v === null ? null : urlCheck(v)),
  strs: (v) => (Array.isArray(v) && v.every((s) => isStr(s) && s.trim()) ? null : 'must be an array of non-empty strings'),
  urls: (v) => {
    if (!Array.isArray(v)) return 'must be an array of URLs';
    for (const [i, u] of v.entries()) {
      const r = urlCheck(u);
      if (r) return typeof r === 'string' ? `[${i}] ${r}` : { warn: `[${i}] ${r.warn}` };
    }
    return null;
  },
  oneOf: (...vals) => (v) => (vals.includes(v) ? null : `must be one of ${vals.map((x) => JSON.stringify(x)).join(' | ')}, got ${JSON.stringify(v)}`),
  nOneOf: (...vals) => (v) => (v === null || vals.includes(v) ? null : `must be one of ${vals.map((x) => JSON.stringify(x)).join(' | ')} or null, got ${JSON.stringify(v)}`),
  id: (prefix) => (v) => (isStr(v) && new RegExp(`^${prefix}_[a-z0-9]{3,16}$`).test(v) ? null : `must be an id like "${prefix}_7kq2mx", got ${JSON.stringify(v)}`),
  ids: (prefix) => (v) => {
    if (!Array.isArray(v) || !v.length) return 'must be a non-empty array of ids';
    const bad = v.find((x) => T.id(prefix)(x));
    return bad === undefined ? null : `has a bad id ${JSON.stringify(bad)} (want "${prefix}_...")`;
  },
  preview: (v) => {
    if (!Array.isArray(v)) return 'must be an array of { label, low, high }';
    for (const [i, p] of v.entries()) {
      const keys = Object.keys(p || {}).sort().join(',');
      if (keys !== 'high,label,low') return `[${i}] must have exactly label, low, high (has ${keys || 'nothing'})`;
      if (!isStr(p.label) || !p.label.trim()) return `[${i}].label must be a non-empty string`;
      if (!isPence(p.low) || !isPence(p.high)) return `[${i}] low/high must be integer pence`;
      if (p.low > p.high) return `[${i}] low ${p.low} is above high ${p.high}`;
    }
    return null;
  },
  comps: (v) => {
    if (!Array.isArray(v)) return 'must be an array of { source, title, price, url }';
    for (const [i, c] of v.entries()) {
      const keys = Object.keys(c || {}).sort().join(',');
      if (keys !== 'price,source,title,url') return `[${i}] must have exactly source, title, price, url (has ${keys || 'nothing'})`;
      if (!isStr(c.source) || !c.source.trim() || !isStr(c.title) || !c.title.trim()) return `[${i}] source and title must be non-empty strings`;
      if (!Number.isInteger(c.price) || c.price <= 0) return `[${i}].price must be integer pence > 0, got ${JSON.stringify(c.price)}`;
      const u = urlCheck(c.url);
      if (typeof u === 'string') return `[${i}].url ${u}`;
    }
    return null;
  },
};

const SHAPES = {
  pickups: {
    id: T.id('p'), seller_name: T.text, address: T.str, transcript: T.str,
    estimate_low: T.pence, estimate_high: T.pence, preview: T.preview,
    status: T.oneOf('estimated', 'booked', 'collected', 'listed'),
    runner_name: T.nstr, created_at: T.iso,
  },
  items: {
    id: T.id('i'), pickup_id: T.id('p'), label: T.text, brand: T.nstr, type: T.oneOf(...TYPES), size: T.nstr,
    grade: T.nOneOf(...GRADES), condition_notes: T.strs, special: T.nstr, claim: T.nstr, claim_proof: T.nurl,
    seller_ask: T.npence, price_source: T.oneOf('comps', 'seller', 'table'), price_confidence: T.oneOf('high', 'medium', 'low'),
    seller_story: T.nstr, photo_requests: T.strs, proof_request: T.nstr, seller_proof: T.urls, photos: T.urls, comps: T.comps,
    list_price: T.pence, floor_price: T.pence, shopify_url: T.nurl,
    status: T.oneOf('estimated', 'needs_photos', 'photographed', 'listed', 'offer', 'sold', 'posted'),
  },
  jobs: {
    id: T.id('j'), type: T.oneOf('pickup', 'post'), pickup_id: T.id('p'), item_ids: T.ids('i'),
    runner_name: T.nstr, address: T.str, pay: T.pence, status: T.oneOf('open', 'accepted', 'done'),
  },
  offers: {
    id: T.id('o'), item_id: T.id('i'), buyer: T.text, amount: T.pence, counter: T.npence,
    round: T.oneOf(1, 2), status: T.oneOf('pending', 'accepted', 'countered', 'rejected'), discount_code: T.nstr,
  },
  ledger: {
    id: T.id('l'), item_id: T.id('i'), sale_price: T.pence, seller_amount: T.pence, runner_amount: T.pence, our_amount: T.signedPence,
  },
  events: {
    id: T.id('e'), ts: T.iso, actor: T.oneOf('agent', 'seller', 'runner', 'buyer'), text: T.text, money: T.npence,
  },
};
const KINDS = Object.keys(SHAPES);

// ---------- reporting ----------

const errors = [];
const warnings = [];
let strict = true; // false for a live server: history checks become warnings
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);
const hist = (where, msg) => (strict ? err : warn)(where, msg);
const gbp = (p) => (p == null ? '?' : `£${p % 100 === 0 ? p / 100 : (p / 100).toFixed(2)}`);

function checkFields(where, row, spec) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return err(where, 'must be an object');
  for (const k of Object.keys(spec)) {
    if (!(k in row)) {
      err(where, `missing field "${k}"`);
      continue;
    }
    const r = spec[k](row[k]);
    if (typeof r === 'string') err(`${where}.${k}`, r);
    else if (r?.warn) warn(`${where}.${k}`, r.warn);
  }
  for (const k of Object.keys(row)) if (!(k in spec)) err(where, `unknown field "${k}"${k === 'meta' ? ' (meta must be stripped from GET /api/state)' : ''}`);
}

// ---------- state payload ----------

function validateState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return err('payload', 'must be an object');
  for (const k of KINDS) if (!Array.isArray(s[k])) err('payload', `"${k}" must be an array`);
  for (const k of Object.keys(s)) if (!KINDS.includes(k)) err('payload', `unknown top-level key "${k}"`);
  if (errors.length) return;

  const tag = (kind, row, i) => `${kind}[${i}]${row?.id ? ` ${row.id}` : ''}`;
  const seen = new Set();
  for (const kind of KINDS) {
    s[kind].forEach((row, i) => {
      checkFields(tag(kind, row, i), row, SHAPES[kind]);
      if (row?.id != null) {
        if (seen.has(row.id)) err(tag(kind, row, i), `duplicate id ${row.id}`);
        seen.add(row.id);
      }
    });
  }
  if (errors.length) return; // shape errors first; the cross checks assume the shapes are right

  const byId = (kind) => new Map(s[kind].map((r) => [r.id, r]));
  const ctx = {
    s,
    pickups: byId('pickups'),
    items: byId('items'),
    offersOf: (itemId) => s.offers.filter((o) => o.item_id === itemId),
    ledgerOf: (itemId) => s.ledger.filter((l) => l.item_id === itemId),
    postJobsOf: (itemId) => s.jobs.filter((j) => j.type === 'post' && j.item_ids.includes(itemId)),
  };

  s.pickups.forEach((p, i) => checkPickup(tag('pickups', p, i), p, ctx));
  s.items.forEach((it, i) => checkItem(tag('items', it, i), it, ctx));
  s.jobs.forEach((j, i) => checkJob(tag('jobs', j, i), j, ctx));
  s.offers.forEach((o, i) => checkOffer(tag('offers', o, i), o, i, ctx));
  s.ledger.forEach((l, i) => checkLedger(tag('ledger', l, i), l, ctx));
  checkEvents(s.events, ctx);
}

function checkPickup(where, p, ctx) {
  const items = ctx.s.items.filter((it) => it.pickup_id === p.id);
  const sumLow = p.preview.reduce((a, x) => a + x.low, 0);
  const sumHigh = p.preview.reduce((a, x) => a + x.high, 0);
  if (p.estimate_low !== sumLow) err(where, `estimate_low ${p.estimate_low} should be the sum of preview lows (${sumLow})`);
  if (p.estimate_high !== sumHigh) err(where, `estimate_high ${p.estimate_high} should be the sum of preview highs (${sumHigh})`);
  if (p.preview.length !== items.length) warn(where, `preview has ${p.preview.length} lines but the pickup has ${items.length} items`);

  // Each preview line should match its item (same order, same label) and the preview rule.
  p.preview.forEach((line, k) => {
    const it = items[k];
    if (!it) return;
    if (line.label !== it.label) warn(`${where}.preview[${k}]`, `label "${line.label}" doesn't match item ${it.id} "${it.label}"`);
    const tier = inferTier(it.brand);
    const want = previewRange({ type: it.type, tier, special: it.special, seller_ask: it.seller_ask, comps: it.comps });
    const rangeFor = (t) => previewRange({ type: it.type, tier: t, special: it.special, seller_ask: it.seller_ask, comps: it.comps });
    const otherTier = it.brand && TIERS.find((t) => rangeFor(t).low === line.low && rangeFor(t).high === line.high);
    if (!want) warn(`${where}.preview[${k}]`, `can't check the range: brand tier of "${it.brand}" isn't known to the validator`);
    else if ((want.low !== line.low || want.high !== line.high) && otherTier) {
      warn(`${where}.preview[${k}]`, `range fits tier "${otherTier}", not the validator's guess "${tier}" for "${it.brand}"`);
    } else if (want.low !== line.low || want.high !== line.high) {
      hist(`${where}.preview[${k}]`, `${gbp(line.low)}-${gbp(line.high)} but the preview rule gives ${gbp(want.low)}-${gbp(want.high)} for ${it.id}`);
    }
  });

  if (['collected', 'listed'].includes(p.status) && !p.runner_name) warn(where, `status "${p.status}" but runner_name is null`);
  if (p.status !== 'estimated' && !ctx.s.jobs.some((j) => j.type === 'pickup' && j.pickup_id === p.id)) {
    warn(where, `status "${p.status}" but there is no pickup job`);
  }
  if (p.status === 'listed' && !items.some((it) => ['listed', 'offer', 'sold', 'posted'].includes(it.status))) {
    warn(where, 'status "listed" but none of its items are listed');
  }
}

function checkPrice(where, it) {
  const tier = inferTier(it.brand);
  const input = { type: it.type, tier, grade: it.grade, special: it.special, seller_ask: it.seller_ask, comps: it.comps };
  let want = rulePrice(input);

  // Before grading is final the list may still be the estimate-time price (grade assumed B).
  if (['estimated', 'needs_photos'].includes(it.status) && it.grade && it.grade !== 'B' && want.list !== it.list_price) {
    const early = rulePrice({ ...input, grade: null });
    if (early.list === it.list_price) want = early;
  }

  if (it.price_source !== want.source) {
    const n = compPrices(it.comps).length;
    return err(`${where}.price_source`, `is "${it.price_source}" but the rule says "${want.source}" (seller_ask ${it.seller_ask ?? 'null'}, ${n} priced comps)`);
  }

  // The real tier lives in item.meta (Claude's call); ours is a guess from a brand list, so a different tier that fits is a warning.
  const fitsTier = (t) => rulePrice({ ...input, tier: t }).list === it.list_price || rulePrice({ ...input, tier: t, grade: null }).list === it.list_price;
  const otherTier = want.source === 'table' && want.list != null && it.list_price !== want.list && it.brand && TIERS.some(fitsTier);
  if (want.source === 'table' && (want.list == null || otherTier)) {
    const fits = TIERS.filter(fitsTier);
    const guess = want.list == null ? `brand tier of "${it.brand}" isn't known to the validator` : `validator guessed tier "${tier}" for "${it.brand}"`;
    warn(where, `${guess}; ${fits.length ? `list_price fits tier "${fits.join('" or "')}"` : 'list_price fits no tier'}`);
    if (it.price_confidence !== 'low') err(`${where}.price_confidence`, 'table prices must be "low"');
    if (it.floor_price !== Math.round(it.list_price * FLOOR)) err(`${where}.floor_price`, `${it.floor_price} should be 70% of list (${Math.round(it.list_price * FLOOR)})`);
    return;
  }

  const how =
    want.source === 'seller' ? `seller ask ${gbp(it.seller_ask)}`
    : want.source === 'comps' ? `median ${gbp(want.raw)} x grade ${it.grade ?? 'B (assumed)'}${it.special ? ' x 1.2 special' : ''}`
    : `table ${it.type} ${TYPE_BASE[it.type]} x ${tier} x grade ${it.grade ?? 'B (assumed)'}`;
  if (it.list_price !== want.list) err(`${where}.list_price`, `${it.list_price} but the rule gives ${want.list} (${how})`);
  if (it.floor_price !== want.floor) err(`${where}.floor_price`, `${it.floor_price} but the rule gives ${want.floor} (${want.source === 'seller' ? '80% of the ask' : '70% of list'})`);
  if (onBoundary(want.exact)) warn(where, `unrounded price ${want.exact.toFixed(2)} sits on a .50 rounding boundary; float error could flip it`);

  if (want.source === 'seller') {
    if (it.price_confidence !== want.confidence) warn(`${where}.price_confidence`, `"${it.price_confidence}" but pricing.js would say "${want.confidence}"`);
  } else if (it.price_confidence !== want.confidence) {
    err(`${where}.price_confidence`, `"${it.price_confidence}" but the rule says "${want.confidence}" (${compPrices(it.comps).length} comps)`);
  }
  if (want.source === 'table' && it.comps.length) warn(`${where}.comps`, 'table-priced but has comps (fewer than 2 with prices?)');
}

function checkItem(where, it, ctx) {
  if (!ctx.pickups.has(it.pickup_id)) err(`${where}.pickup_id`, `pickup ${it.pickup_id} doesn't exist`);
  checkPrice(where, it);

  if (it.comps.length > 5) warn(`${where}.comps`, `${it.comps.length} comps; only the first 5 count`);
  const known = ['eBay', 'Depop', 'ASOS Marketplace', 'Vestiaire Collective'];
  it.comps.forEach((c, k) => known.includes(c.source) || warn(`${where}.comps[${k}].source`, `"${c.source}" isn't one of ${known.join(', ')}`));

  const done = ['photographed', 'listed', 'offer', 'sold', 'posted'];
  if (it.status === 'needs_photos' && !it.photo_requests.length) err(where, 'status "needs_photos" but photo_requests is empty');
  if (done.includes(it.status)) {
    if (it.photo_requests.length) err(where, `status "${it.status}" but photo_requests isn't empty`);
    if (!it.grade) err(where, `status "${it.status}" but grade is null`);
    if (!it.photos.length) warn(where, `status "${it.status}" but there are no photos`);
  }
  if (['listed', 'offer', 'sold', 'posted'].includes(it.status) && !it.shopify_url) warn(where, `status "${it.status}" but shopify_url is null`);
  if (it.status !== 'estimated' && it.status !== 'needs_photos' && !done.includes(it.status)) err(where, `odd status ${it.status}`);

  if (it.status === 'offer' && !ctx.offersOf(it.id).some((o) => ['pending', 'countered', 'accepted'].includes(o.status))) {
    err(where, 'status "offer" but it has no pending, countered or accepted offer');
  }
  if (['sold', 'posted'].includes(it.status)) {
    if (ctx.ledgerOf(it.id).length !== 1) err(where, `status "${it.status}" needs exactly one ledger row (has ${ctx.ledgerOf(it.id).length})`);
    const posts = ctx.postJobsOf(it.id);
    if (!posts.length) err(where, `status "${it.status}" but there is no post job`);
    else if (it.status === 'posted' && !posts.some((j) => j.status === 'done')) err(where, 'status "posted" but its post job isn\'t done');
    else if (it.status === 'sold' && posts.every((j) => j.status === 'done')) err(where, 'status "sold" but its post job is already done (should be "posted")');
  }

  if (!it.claim) {
    if (it.claim_proof) warn(where, 'claim_proof set without a claim');
    if (it.proof_request) warn(where, 'proof_request set without a claim');
  } else {
    if (!it.proof_request && !it.seller_proof.length) warn(where, 'has a claim but no proof_request and no seller_proof');
    if (it.claim_proof && !it.photos.includes(it.claim_proof)) warn(`${where}.claim_proof`, "isn't one of the item's photos");
  }
  if (it.proof_request && it.seller_proof.length) warn(where, 'seller_proof arrived but proof_request was not cleared');
}

function checkJob(where, j, ctx) {
  if (!ctx.pickups.has(j.pickup_id)) err(`${where}.pickup_id`, `pickup ${j.pickup_id} doesn't exist`);
  for (const iid of j.item_ids) {
    const it = ctx.items.get(iid);
    if (!it) err(`${where}.item_ids`, `item ${iid} doesn't exist`);
    else if (it.pickup_id !== j.pickup_id) err(`${where}.item_ids`, `item ${iid} belongs to pickup ${it.pickup_id}, not ${j.pickup_id}`);
  }
  if (j.type === 'pickup' && j.pay !== RUNNER_FEE * j.item_ids.length) {
    err(`${where}.pay`, `${j.pay} but a pickup job pays 600 x ${j.item_ids.length} items = ${RUNNER_FEE * j.item_ids.length}`);
  }
  if (j.type === 'post') {
    // DESIGN.md: the "£6" posting card, the same money as the ledger's runner_amount (never add the two).
    if (j.pay !== RUNNER_FEE) err(`${where}.pay`, `${j.pay} but a post job pays ${RUNNER_FEE}`);
    for (const iid of j.item_ids) {
      const it = ctx.items.get(iid);
      if (it && !['sold', 'posted'].includes(it.status)) err(where, `post job for ${iid} but that item is "${it.status}"`);
    }
  }
  if (j.status !== 'open' && !j.runner_name) err(where, `status "${j.status}" but runner_name is null`);
  if (j.status === 'open' && j.runner_name) warn(where, 'status "open" but runner_name is set');
  if (!j.address.trim()) warn(`${where}.address`, 'is empty');
}

function checkOffer(where, o, index, ctx) {
  const it = ctx.items.get(o.item_id);
  if (!it) return err(`${where}.item_id`, `item ${o.item_id} doesn't exist`);
  const earlier = ctx.s.offers.slice(0, index).filter((x) => x.item_id === o.item_id && x.buyer === o.buyer);
  if (o.round === 2 && !earlier.length) err(where, `round 2 but ${o.buyer} has no earlier offer on ${o.item_id}`);
  if (o.round === 1 && earlier.length) warn(where, `round 1 but ${o.buyer} already made an offer on ${o.item_id}`);
  if (o.status !== 'countered' && o.counter !== null) err(`${where}.counter`, `must be null unless status is "countered"`);
  if (o.status !== 'accepted' && o.discount_code !== null) err(`${where}.discount_code`, `must be null unless status is "accepted"`);

  if (o.status === 'countered') {
    if (o.round !== 1) err(where, 'only round 1 offers are countered; round 2 below floor is rejected');
    if (o.amount >= it.floor_price) hist(where, `countered, but ${gbp(o.amount)} is at or above the floor ${gbp(it.floor_price)} (should be accepted)`);
    const want = counterFor(o.amount, it.list_price, it.floor_price);
    if (o.counter !== want) hist(`${where}.counter`, `${o.counter} but the rule gives ${want} (midpoint of ${gbp(o.amount)} and ${gbp(it.list_price)}, never below floor ${gbp(it.floor_price)})`);
  } else if (o.status === 'accepted') {
    if (o.amount < it.floor_price) hist(where, `accepted at ${gbp(o.amount)}, below the floor ${gbp(it.floor_price)}`);
    if (o.amount < it.list_price && !o.discount_code) warn(`${where}.discount_code`, `accepted below list (${gbp(it.list_price - o.amount)} off) but no discount code`);
  } else if (o.status === 'rejected') {
    const soldAlready = ['sold', 'posted'].includes(it.status);
    if (!soldAlready && o.round !== 2) hist(where, 'rejected in round 1; round 1 below floor should be countered');
    if (!soldAlready && o.amount >= it.floor_price) hist(where, `rejected, but ${gbp(o.amount)} is at or above the floor ${gbp(it.floor_price)}`);
  } else if (o.status === 'pending') {
    warn(where, 'still "pending"; offers are normally answered straight away');
  }
}

function checkLedger(where, l, ctx) {
  const it = ctx.items.get(l.item_id);
  if (!it) return err(`${where}.item_id`, `item ${l.item_id} doesn't exist`);
  if (ctx.ledgerOf(l.item_id).length > 1) err(where, `item ${l.item_id} has more than one ledger row`);
  if (!['sold', 'posted'].includes(it.status)) err(where, `ledger row for ${l.item_id} but that item is "${it.status}"`);
  const seller = Math.round(l.sale_price * SELLER_SHARE);
  if (l.seller_amount !== seller) err(`${where}.seller_amount`, `${l.seller_amount} but 70% of ${l.sale_price} is ${seller}`);
  if (l.runner_amount !== RUNNER_FEE) err(`${where}.runner_amount`, `${l.runner_amount} but the runner gets a flat 600`);
  const ours = l.sale_price - l.seller_amount - l.runner_amount;
  if (l.our_amount !== ours) err(`${where}.our_amount`, `${l.our_amount} but sale - seller - runner = ${ours}`);
  if (l.our_amount < 0) warn(where, `we lose ${gbp(-l.our_amount)} on this sale`);
  const accepted = ctx.offersOf(l.item_id).filter((o) => o.status === 'accepted').at(-1);
  const expected = accepted ? accepted.amount : it.list_price;
  if (l.sale_price !== expected) hist(`${where}.sale_price`, `${l.sale_price} but ${accepted ? `the accepted offer was ${expected}` : `list_price is ${expected} and there was no accepted offer`}`);
}

function checkEvents(events, ctx) {
  for (let i = 1; i < events.length; i++) {
    if (Date.parse(events[i].ts) < Date.parse(events[i - 1].ts)) err(`events[${i}] ${events[i].id}`, 'events must be in time order');
  }
  events.forEach((e, i) => {
    const where = `events[${i}] ${e.id}`;
    if (/\bas an ai\b/i.test(e.text)) err(`${where}.text`, 'never "As an AI"');
    if (EMOJI_RE.test(e.text)) err(`${where}.text`, 'no emoji in the feed');
    if (e.text.length > 160) warn(`${where}.text`, `${e.text.length} chars; keep feed lines short`);
    if (!/[.?!]$/.test(e.text.trim())) warn(`${where}.text`, "doesn't end like a sentence");

    const spotted = /^Spotted (\d+) items?\. Expect £([\d.]+) to £([\d.]+)\.$/.exec(e.text);
    if (spotted) {
      const high = Math.round(Number(spotted[3]) * 100);
      if (e.money !== high) hist(`${where}.money`, `${e.money} but the text says the high end is ${gbp(high)}`);
      if (!ctx.s.pickups.some((p) => p.estimate_high === high)) hist(where, `no pickup has estimate_high ${high}`);
    }
    const sold = /^Sold .+ for £([\d.]+)\./.exec(e.text);
    if (sold) {
      const sale = Math.round(Number(sold[1]) * 100);
      if (e.money !== sale) hist(`${where}.money`, `${e.money} but the text says it sold for ${gbp(sale)}`);
      if (!ctx.s.ledger.some((l) => l.sale_price === sale)) hist(where, `no ledger row has sale_price ${sale}`);
    }
  });
}

// ---------- demo cache (DESIGN.md "Demo cache format") ----------

const CACHE_TOP = ['seller_name', 'address', 'runner_name', 'transcript', 'items', 'sale'];
const CACHE_ITEM = [
  'key', 'match', 'label', 'brand', 'type', 'type_label', 'size', 'brand_tier',
  'seller_story', 'story_safe', 'claim', 'claim_noun', 'claim_line', 'seller_ask', 'proof_request',
  'search_query', 'estimate_notes', 'grade', 'condition_notes', 'special',
  'photos', 'claim_proof', 'retake', 'comps', 'description',
];
const PRICE_KEYS = ['list_price', 'floor_price', 'price_source', 'price_confidence', 'low', 'high', 'estimate_low', 'estimate_high'];

const CACHE_ITEM_SPEC = {
  key: (v) => (isStr(v) && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) ? null : 'must be a lowercase slug like "levis-trucker"'),
  match: (v) => (Array.isArray(v) && v.length && v.every((w) => isStr(w) && w === w.toLowerCase() && w.trim()) ? null : 'must be a non-empty array of lowercase words'),
  label: T.text, brand: T.nstr, type: T.oneOf(...TYPES), type_label: T.text, size: T.nstr, brand_tier: T.oneOf(...TIERS),
  seller_story: T.nstr, story_safe: T.nstr, claim: T.nstr, claim_noun: T.nstr, claim_line: T.nstr, seller_ask: T.npence,
  proof_request: T.nstr, search_query: T.text, estimate_notes: (v) => (Array.isArray(v) && v.every((s) => isStr(s) && s.trim()) ? null : 'must be an array of strings'),
  grade: T.oneOf(...GRADES), condition_notes: T.strs, special: T.nstr, photos: T.urls, claim_proof: T.nurl,
  retake: (v) => (v === null || (v && typeof v === 'object' && !Array.isArray(v)) ? null : 'must be null or an object'),
  comps: T.comps,
  description: (v) => (v && typeof v === 'object' && !Array.isArray(v) ? null : 'must be an object { title, body, proof_line }'),
};

function validateCache(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return err('cache', 'must be an object');
  for (const k of CACHE_TOP) if (!(k in c)) err('cache', `missing "${k}"`);
  for (const k of Object.keys(c)) if (!CACHE_TOP.includes(k)) err('cache', `unknown key "${k}"`);
  for (const k of ['seller_name', 'address', 'runner_name', 'transcript']) if (!isStr(c[k]) || !c[k].trim()) err(`cache.${k}`, 'must be a non-empty string');
  if (!Array.isArray(c.items) || !c.items.length) return err('cache.items', 'must be a non-empty array');
  if (c.items.length !== 6) warn('cache.items', `${c.items.length} items; the demo pile is planned as 6`);

  const keys = new Set();
  c.items.forEach((ci, i) => {
    const where = `cache.items[${i}]${ci?.key ? ` ${ci.key}` : ''}`;
    for (const k of Object.keys(ci || {})) {
      if (PRICE_KEYS.includes(k)) err(where, `"${k}" must not be stored in the cache; pricing.js computes prices`);
    }
    const spec = Object.fromEntries(CACHE_ITEM.map((k) => [k, CACHE_ITEM_SPEC[k]]));
    const before = errors.length;
    checkFields(where, Object.fromEntries(Object.entries(ci || {}).filter(([k]) => !PRICE_KEYS.includes(k))), spec);
    if (errors.length > before) return;
    if (keys.has(ci.key)) err(where, `duplicate key "${ci.key}"`);
    keys.add(ci.key);
    checkCacheItem(where, ci, c);
  });

  checkMatchWords(c.items);
  checkSale(c);
}

function checkCacheItem(where, ci, c) {
  const hay = norm(`${ci.label} ${ci.brand || ''}`);
  if (!ci.match.every((w) => hay.includes(norm(w)))) warn(`${where}.match`, `not every word appears in its own label+brand ("${hay}")`);
  if (ci.brand == null && ci.brand_tier !== 'unknown') warn(`${where}.brand_tier`, 'no brand, so the tier is normally "unknown"');
  const inferred = inferTier(ci.brand);
  if (inferred && ci.brand && inferred !== ci.brand_tier) warn(`${where}.brand_tier`, `"${ci.brand_tier}" but the validator would guess "${inferred}"`);

  if (ci.claim) {
    for (const k of ['claim_noun', 'claim_line', 'proof_request', 'story_safe']) if (!ci[k]) err(`${where}.${k}`, 'required when there is a claim');
    if (ci.claim_line && !/^seller says/i.test(ci.claim_line)) err(`${where}.claim_line`, 'must start with "Seller says" (claims are never stated as fact)');
    const verb = norm(ci.claim.split(/\s+/)[0]);
    if (ci.story_safe && norm(ci.story_safe).includes(verb)) warn(`${where}.story_safe`, `still mentions "${verb}"; the claim should be taken out`);
    if (!ci.claim_proof && !ci.retake?.claim_proof) warn(where, 'claim with no claim_proof anywhere; it will stay off the listing');
    if (ci.claim_proof && !ci.photos.includes(ci.claim_proof)) warn(`${where}.claim_proof`, "isn't one of photos");
  } else {
    for (const k of ['claim_noun', 'claim_line', 'story_safe', 'proof_request']) if (ci[k]) warn(`${where}.${k}`, 'set but there is no claim');
  }

  if (ci.retake) {
    const r = ci.retake;
    const rk = Object.keys(r).sort().join(',');
    if (rk !== 'claim_proof,photo_requests,photos_after,request_summary') err(`${where}.retake`, `must have exactly photo_requests, request_summary, photos_after, claim_proof (has ${rk})`);
    const pr = T.strs(r.photo_requests);
    if (pr || !r.photo_requests?.length) err(`${where}.retake.photo_requests`, pr || 'must not be empty');
    if (!isStr(r.request_summary) || !r.request_summary.trim()) err(`${where}.retake.request_summary`, 'must be a non-empty string');
    else if (/^[A-Z]/.test(r.request_summary)) warn(`${where}.retake.request_summary`, 'reads after "Asked the runner for ___." so start it lowercase');
    const after = Array.isArray(r.photos_after) ? r.photos_after : [];
    const pa = T.urls(r.photos_after);
    if (typeof pa === 'string' || !after.length) err(`${where}.retake.photos_after`, typeof pa === 'string' ? pa : 'must not be empty');
    const cp = urlCheck(r.claim_proof);
    if (typeof cp === 'string') err(`${where}.retake.claim_proof`, cp);
    else if (!after.includes(r.claim_proof)) warn(`${where}.retake.claim_proof`, "isn't one of photos_after");
  }

  // Placeholder images go live on Shopify as the item's photos; a placeholder claim_proof is shown to buyers as proof.
  const isPlaceholder = (u) => typeof u === 'string' && /placehold\.co/i.test(u);
  const fakes = [...ci.photos, ...(Array.isArray(ci.retake?.photos_after) ? ci.retake.photos_after : [])].filter(isPlaceholder).length;
  if (fakes) warn(`${where}.photos`, `${fakes} placeholder image${fakes === 1 ? '' : 's'} (placehold.co); run scripts/upload-demo-photos.js with the real pile`);
  for (const [k, u] of [['claim_proof', ci.claim_proof], ['retake.claim_proof', ci.retake?.claim_proof]]) {
    if (isPlaceholder(u)) warn(`${where}.${k}`, 'IS A PLACEHOLDER (placehold.co) but buyers see it as the claim close-up. Photograph the real one before judging');
  }

  const n = ci.comps.length;
  if (n === 1 || n > 5) warn(`${where}.comps`, `${n} comps; use 0 (table) or 2 to 5`);

  const d = ci.description;
  const dk = Object.keys(d).sort().join(',');
  if (dk !== 'body,proof_line,title') err(`${where}.description`, `must have exactly title, body, proof_line (has ${dk})`);
  if (!isStr(d.title) || !d.title.trim()) err(`${where}.description.title`, 'must be a non-empty string');
  else if (d.title.length > 80) warn(`${where}.description.title`, `${d.title.length} chars; Shopify titles read best under 80`);
  if (!isStr(d.body) || !d.body.trim()) err(`${where}.description.body`, 'must be a non-empty string');
  else {
    const paras = d.body.split(/\n\s*\n/).filter((x) => x.trim());
    if (paras.length < 2 || paras.length > 3) warn(`${where}.description.body`, `${paras.length} paragraphs; aim for 2 or 3`);
    if (/£|\bprice\b/i.test(d.body)) err(`${where}.description.body`, 'must not mention price');
    if (/\boffer\b/i.test(d.body)) err(`${where}.description.body`, 'must not include the offer line (the listing adds it)');
    if (/\bAI\b|as an ai/i.test(d.body)) err(`${where}.description.body`, 'must not mention AI');
    if (EMOJI_RE.test(d.body)) err(`${where}.description.body`, 'no emoji');
    if (ci.claim) {
      const verb = norm(ci.claim.split(/\s+/)[0]);
      if (norm(d.body).includes(norm(ci.claim)) || norm(d.body).split(' ').includes(verb)) {
        err(`${where}.description.body`, `mentions the claim ("${verb}"); the listing adds claim_line only when there's proof`);
      }
    }
  }
  if (d.proof_line !== null && !isStr(d.proof_line)) err(`${where}.description.proof_line`, 'must be a string or null');

  if (ci.seller_ask && !c.transcript.includes(gbp(ci.seller_ask))) warn(`${where}.seller_ask`, `${gbp(ci.seller_ask)} isn't said in the transcript`);
}

// A live label should hit exactly one cache item.
function checkMatchWords(items) {
  for (const a of items) {
    if (!Array.isArray(a.match)) continue;
    for (const b of items) {
      if (a === b) continue;
      const hay = norm(`${b.label} ${b.brand || ''}`);
      if (a.match.every((w) => hay.includes(norm(w)))) warn(`cache.items ${a.key}.match`, `also matches "${b.label}"`);
    }
  }
}

function priceOfCache(ci) {
  return rulePrice({ type: ci.type, tier: ci.brand_tier, grade: ci.grade, special: ci.special, seller_ask: ci.seller_ask, comps: ci.comps });
}

function checkSale(c) {
  const s = c.sale;
  if (!s || typeof s !== 'object') return err('cache.sale', 'must be an object');
  const sk = Object.keys(s).sort().join(',');
  if (sk !== 'buyer,discount_code,first_offer,item_key') err('cache.sale', `must have exactly item_key, buyer, first_offer, discount_code (has ${sk})`);
  if (!isStr(s.buyer) || !s.buyer.trim()) err('cache.sale.buyer', 'must be a non-empty string');
  if (!Number.isInteger(s.first_offer) || s.first_offer <= 0) return err('cache.sale.first_offer', 'must be integer pence > 0');
  if (!isStr(s.discount_code) || !/^[A-Z0-9][A-Z0-9-]{3,}$/.test(s.discount_code)) warn('cache.sale.discount_code', 'use capitals, digits and dashes, e.g. "OFFLOAD-LEVI-35"');
  const ci = Array.isArray(c.items) && c.items.find((x) => x.key === s.item_key);
  if (!ci) return err('cache.sale.item_key', `no cache item "${s.item_key}"`);
  const p = priceOfCache(ci);
  if (p.list == null) return;
  if (s.first_offer >= p.floor) err('cache.sale.first_offer', `${gbp(s.first_offer)} must be below the floor ${gbp(p.floor)} so the agent counters`);
  const counter = counterFor(s.first_offer, p.list, p.floor);
  const digits = /(\d+)$/.exec(s.discount_code || '');
  if (digits && Number(digits[1]) * 100 !== counter) warn('cache.sale.discount_code', `ends in ${digits[1]} but the agreed price will be ${gbp(counter)}`);
}

function printCachePrices(c) {
  const rows = c.items.map((ci) => {
    const p = priceOfCache(ci);
    let note = '';
    if (p.source === 'table') note = 'no comps: asks the seller "What would you want for it?"';
    if (p.source === 'seller' && p.above) note = `warns: similar ones sell around ${gbp(p.raw)}`;
    if (ci.retake) note = `retake first: ${ci.retake.request_summary}`;
    return [ci.key, p.source, p.confidence, gbp(p.list), gbp(p.floor), note];
  });
  const s = c.sale;
  const sp = priceOfCache(c.items.find((x) => x.key === s.item_key));
  console.log('\nComputed prices (pricing rule, not stored in the cache):');
  const w = [18, 7, 7, 7, 8];
  for (const r of rows) console.log('  ' + r.map((x, i) => (i < 5 ? String(x).padEnd(w[i]) : x)).join(' '));
  console.log(`\nSale: ${s.buyer} offers ${gbp(s.first_offer)} for ${s.item_key} (list ${gbp(sp.list)}, floor ${gbp(sp.floor)}),` +
    ` agent counters at ${gbp(counterFor(s.first_offer, sp.list, sp.floor))}, code ${s.discount_code}.`);
}

// ---------- main ----------

async function loadState(arg) {
  if (/^https?:\/\//.test(arg)) {
    strict = false;
    const url = `${arg.replace(/\/+$/, '').replace(/\/api\/state$/, '')}/api/state`;
    const r = await fetch(url, { headers: { 'ngrok-skip-browser-warning': '1', accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`GET ${url} answered ${r.status}`);
    return { label: url, data: await r.json() };
  }
  const file = path.resolve(arg || path.join(ROOT, 'mock', 'seed.json'));
  return { label: path.relative(process.cwd(), file) || file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function report(label, counts) {
  console.log(`validate: ${label}`);
  if (counts) console.log(`  ${counts}`);
  for (const e of errors) console.log(`  ERROR  ${e}`);
  for (const w of warnings) console.log(`  warn   ${w}`);
  console.log(`${errors.length ? 'FAIL' : 'OK'}: ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/validate.js [seed.json | state.json | https://api-base] | --cache [demo.json]');
    return;
  }
  if (args.includes('--cache')) {
    const file = path.resolve(args.find((a) => a !== '--cache') || path.join(ROOT, 'cache', 'demo.json'));
    const label = path.relative(process.cwd(), file) || file;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      err(label, `can't read JSON (${e.message})`);
    }
    if (data) validateCache(data);
    report(label, data?.items ? `${data.items.length} demo items for ${data.seller_name}` : null);
    if (data && !errors.length) printCachePrices(data);
  } else {
    let loaded;
    try {
      loaded = await loadState(args[0]);
    } catch (e) {
      err(args[0] || 'mock/seed.json', e.message);
    }
    if (loaded) validateState(loaded.data);
    const d = loaded?.data;
    const counts = d && KINDS.every((k) => Array.isArray(d[k])) ? KINDS.map((k) => `${d[k].length} ${k}`).join(', ') : null;
    report(loaded?.label || args[0] || 'mock/seed.json', counts);
  }
  process.exitCode = errors.length ? 1 : 0;
}

main();
