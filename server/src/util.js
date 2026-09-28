// Small shared helpers: ids, money, time, timeouts, logging.
import crypto from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

// Short ids like "i_k3x9q2". Prefixes: p pickup, i item, j job, o offer, l ledger, e event.
export function id(prefix) {
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % 36];
  return `${prefix}_${s}`;
}

export const nowIso = () => new Date().toISOString();

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 3800 -> "£38", 2660 -> "£26.60", -150 -> "-£1.50"
export function gbp(pence) {
  if (pence == null || !Number.isFinite(pence)) return '';
  const neg = pence < 0;
  const v = Math.abs(Math.round(pence));
  const s = v % 100 === 0 ? String(v / 100) : (v / 100).toFixed(2);
  return `${neg ? '-' : ''}£${s}`;
}

// Whole pounds, never below £1.
export const roundPounds = (pence) => Math.max(100, Math.round(pence / 100) * 100);

// Any value to integer pence, or null. Accepts 3800, "3800", 38.5 (treated as pence) - callers convert pounds themselves.
export function toPence(v) {
  if (v == null || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export class TimeoutError extends Error {
  constructor(label, ms) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

// Races a promise against a timer. The timer never keeps the process alive.
export function withTimeout(promise, ms, label = 'call') {
  let timer;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

export function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

export function warn(...args) {
  console.warn(new Date().toISOString().slice(11, 19), '[warn]', ...args);
}

export const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

// "Levi's denim jacket" -> "levi's denim jacket" for loose matching
export const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9£' ]+/g, ' ').replace(/\s+/g, ' ').trim();
