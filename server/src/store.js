// In-memory state (the source of truth for GET /api/state) with write-through to Supabase.
// Memory answers every poll instantly; Supabase gets the latest version of each changed row every 500 ms.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { supabase } from './db.js';
import { id, nowIso, log, warn, withTimeout } from './util.js';

export const KINDS = ['pickups', 'items', 'jobs', 'offers', 'ledger', 'events'];

// Exact contract columns per table (items also persist meta).
const FIELDS = {
  pickups: ['id', 'seller_name', 'address', 'transcript', 'estimate_low', 'estimate_high', 'preview', 'status', 'runner_name', 'created_at'],
  items: [
    'id', 'pickup_id', 'label', 'brand', 'type', 'size', 'grade', 'condition_notes', 'special', 'claim', 'claim_proof',
    'seller_ask', 'price_source', 'price_confidence', 'seller_story', 'photo_requests', 'proof_request', 'seller_proof',
    'photos', 'comps', 'list_price', 'floor_price', 'shopify_url', 'status', 'meta',
  ],
  jobs: ['id', 'type', 'pickup_id', 'item_ids', 'runner_name', 'address', 'pay', 'status'],
  offers: ['id', 'item_id', 'buyer', 'amount', 'counter', 'round', 'status', 'discount_code'],
  ledger: ['id', 'item_id', 'sale_price', 'seller_amount', 'runner_amount', 'our_amount'],
  events: ['id', 'ts', 'actor', 'text', 'money'],
};

const SEED_PATH = path.join(ROOT, 'mock', 'seed.json');

export const state = { pickups: [], items: [], jobs: [], offers: [], ledger: [], events: [] };

let dbOk = Boolean(supabase);

function readSeed() {
  const raw = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const s = {};
  for (const k of KINDS) s[k] = Array.isArray(raw[k]) ? structuredClone(raw[k]) : [];
  return s;
}

function replaceState(next) {
  for (const k of KINDS) {
    state[k].length = 0;
    state[k].push(...(next[k] || []));
  }
  for (const it of state.items) it.meta = it.meta && typeof it.meta === 'object' ? it.meta : {};
  state.events.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}

// ---------- reads ----------

export const find = (kind, rowId) => state[kind].find((r) => r.id === rowId) || null;
export const itemsOf = (pickupId) => state.items.filter((i) => i.pickup_id === pickupId);

export function publicItem(item) {
  if (!item) return item;
  const { meta, ...rest } = item;
  return rest;
}

// The contract payload. Never calls a model, never touches the network.
export function publicState() {
  return {
    pickups: state.pickups,
    items: state.items.map(publicItem),
    jobs: state.jobs,
    offers: state.offers,
    ledger: state.ledger,
    events: state.events,
  };
}

// ---------- writes ----------

const dirty = new Map(); // "kind\0id" -> { kind, row }

export function save(kind, row) {
  if (dbOk) dirty.set(`${kind}\0${row.id}`, { kind, row });
  return row;
}

export function add(kind, row) {
  state[kind].push(row);
  return save(kind, row);
}

let lastTs = '';
// Adds one line to the live feed. money in pence or null.
export function event(actor, text, money = null) {
  let ts = nowIso();
  if (ts <= lastTs) ts = new Date(Date.parse(lastTs) + 1).toISOString(); // keep feed order stable
  lastTs = ts;
  const e = { id: id('e'), ts, actor, text, money: money == null ? null : Math.round(money) };
  add('events', e);
  log(`[${actor}] ${text}`);
  return e;
}

const toRow = (kind, row) => Object.fromEntries(FIELDS[kind].map((f) => [f, row[f] === undefined ? null : row[f]]));

let flushing = false;
const failures = {};

export async function flush() {
  if (flushing || !dbOk || !dirty.size) return;
  flushing = true;
  const batch = [...dirty.values()];
  dirty.clear();
  try {
    const byKind = {};
    for (const { kind, row } of batch) (byKind[kind] ||= []).push(row);
    // Parents before children, so tables with foreign keys (items -> pickups, offers -> items...) accept every row.
    for (const [kind, rows] of KINDS.filter((k) => byKind[k]).map((k) => [k, byKind[k]])) {
      const { error } = await supabase.from(kind).upsert(rows.map((r) => toRow(kind, r)));
      // A table made from an older schema (e.g. items without meta): stop sending that column and save the rest.
      const missing = error && /could not find the '([^']+)' column/i.exec(error.message || '');
      if (missing && FIELDS[kind].includes(missing[1]) && missing[1] !== 'id') {
        FIELDS[kind] = FIELDS[kind].filter((f) => f !== missing[1]);
        warn(`Supabase ${kind} has no "${missing[1]}" column; saving without it. Run schema.sql to add it.`);
        for (const row of rows) if (!dirty.has(`${kind}\0${row.id}`)) dirty.set(`${kind}\0${row.id}`, { kind, row });
        continue;
      }
      if (error) {
        failures[kind] = (failures[kind] || 0) + 1;
        warn(`Supabase write to ${kind} failed (${failures[kind]}):`, error.message);
        if (failures[kind] < 3) for (const row of rows) if (!dirty.has(`${kind}\0${row.id}`)) dirty.set(`${kind}\0${row.id}`, { kind, row });
      } else failures[kind] = 0;
    }
  } catch (e) {
    warn('Supabase flush failed:', e.message);
  } finally {
    flushing = false;
  }
}

setInterval(flush, 500).unref();

async function writeAll() {
  if (!dbOk) return;
  for (const k of KINDS) for (const row of state[k]) save(k, row);
  await flush();
}

// ---------- lifecycle ----------

// Supabase if it has rows, else the seed (which is then written to Supabase).
export async function load() {
  if (supabase && !config.resetOnBoot) {
    try {
      // No retries and a hard cap, so an unreachable Supabase can't hold up boot (the seed takes over).
      const results = await withTimeout(
        Promise.all(KINDS.map((k) => supabase.from(k).select('*').limit(5000).retry(false))),
        6000,
        'supabase load',
      );
      const bad = results.find((r) => r.error);
      if (bad) throw new Error(bad.error.message);
      const loaded = Object.fromEntries(KINDS.map((k, i) => [k, results[i].data || []]));
      if (loaded.pickups.length || loaded.items.length || loaded.events.length) {
        replaceState(loaded);
        log(`Loaded state from Supabase (${state.items.length} items, ${state.events.length} events)`);
        return 'supabase';
      }
    } catch (e) {
      dbOk = false;
      warn(`Supabase not usable (${e.message}). Running from memory only. Did you run schema.sql?`);
    }
  }
  replaceState(readSeed());
  await writeAll();
  log(`Loaded seed (${state.items.length} items)`);
  return 'seed';
}

// Back to the seed, in memory and in Supabase.
export async function reset() {
  dirty.clear();
  replaceState(readSeed());
  lastTs = '';
  if (dbOk) {
    try {
      for (const k of [...KINDS].reverse()) {
        // children first, so foreign keys never block the wipe
        const { error } = await supabase.from(k).delete().neq('id', '');
        if (error) throw new Error(error.message);
      }
    } catch (e) {
      warn('Supabase reset failed:', e.message);
    }
    await writeAll();
  }
}

export const persistence = () => (dbOk ? 'supabase' : 'memory');
