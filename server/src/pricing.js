// The pricing rule from CLAUDE.md as pure functions. All money in pence.
import { roundPounds, toPence } from './util.js';

export const TYPE_BASE = { jacket: 3000, jeans: 2000, hoodie: 2000, 't-shirt': 800, dress: 2200, trainers: 3500, other: 1200 };
export const BRAND_TIER = { designer: 3, premium: 1.8, 'high street': 1, unknown: 0.7 };
export const GRADE_MULT = { A: 1, B: 0.85, C: 0.65, D: 0.4 };
export const SPECIAL_MULT = 1.2;

const ASSUMED_GRADE = 'B'; // before the runner's photos arrive
const ASK_WARN_RATIO = 1.5; // "comps say it's worth much less"
const ASK_FLOOR = 0.8;
const FLOOR = 0.7;

export const TYPES = Object.keys(TYPE_BASE);
export const TIERS = Object.keys(BRAND_TIER);

export function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function validPrices(comps) {
  return (comps || [])
    .map((c) => c?.price)
    .filter((p) => Number.isFinite(p) && p > 0)
    .slice(0, 5); // comps arrive best-first; use the closest 3 to 5
}

// Middle of the closest matches, or null when fewer than 2 were found.
export function compsPrice(comps) {
  const prices = validPrices(comps);
  return prices.length >= 2 ? median(prices) : null;
}

export const tableBase = (type, tier) =>
  (TYPE_BASE[type] ?? TYPE_BASE.other) * (BRAND_TIER[tier] ?? BRAND_TIER.unknown);

const mult = (grade, special) => (GRADE_MULT[grade] ?? GRADE_MULT[ASSUMED_GRADE]) * (special ? SPECIAL_MULT : 1);

// Returns the contract price fields plus flags the callers turn into events.
export function priceItem({ type, brand_tier, grade = null, special = null, seller_ask = null, comps = [] }) {
  const matches = validPrices(comps).length;
  const raw = compsPrice(comps); // what similar ones sell for, before grade
  const market = raw != null ? roundPounds(raw * mult(grade, special)) : null;
  const ask = toPence(seller_ask);

  // Rule 4: the seller's ask always wins.
  if (ask) {
    const askAboveMarket = market != null && ask >= market * ASK_WARN_RATIO;
    let confidence = 'medium';
    if (market != null) confidence = askAboveMarket ? 'low' : ask <= market * 1.25 ? 'high' : 'medium';
    return {
      list_price: ask,
      floor_price: Math.round(ask * ASK_FLOOR),
      price_source: 'seller',
      price_confidence: confidence,
      market,
      raw,
      noMatches: raw == null,
      askAboveMarket,
    };
  }

  // Rules 2-3: comps, adjusted by grade and special.
  if (market != null) {
    return {
      list_price: market,
      floor_price: Math.round(market * FLOOR),
      price_source: 'comps',
      price_confidence: matches >= 4 ? 'high' : 'medium',
      market,
      raw,
      noMatches: false,
      askAboveMarket: false,
    };
  }

  // Rule 5: nothing found, no ask -> the table.
  const list = roundPounds(tableBase(type, brand_tier) * mult(grade, special));
  return {
    list_price: list,
    floor_price: Math.round(list * FLOOR),
    price_source: 'table',
    price_confidence: 'low',
    market: null,
    raw: null,
    noMatches: true,
    askAboveMarket: false,
  };
}

// Preview range before grading: worn (C) to like-new (A). A seller ask shows as floor..ask.
export function previewRange({ type, brand_tier, special = null, seller_ask = null, comps = [] }) {
  const ask = toPence(seller_ask);
  if (ask) return { low: Math.round(ask * ASK_FLOOR), high: ask };
  const base = compsPrice(comps) ?? tableBase(type, brand_tier);
  const s = special ? SPECIAL_MULT : 1;
  return { low: roundPounds(base * GRADE_MULT.C * s), high: roundPounds(base * GRADE_MULT.A * s) };
}

// Round-1 counter: midpoint of offer and list, in whole pounds, never below floor or above list.
export function counterOffer({ amount, list_price, floor_price }) {
  const mid = Math.round((amount + list_price) / 2 / 100) * 100;
  return Math.min(list_price, Math.max(floor_price, mid));
}

// Money split per sale: seller 70%, runner flat 600p, we keep the rest.
export const RUNNER_FEE = 600;
export function split(sale_price) {
  const seller_amount = Math.round(sale_price * 0.7);
  return { sale_price, seller_amount, runner_amount: RUNNER_FEE, our_amount: sale_price - seller_amount - RUNNER_FEE };
}
