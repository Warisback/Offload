// Shared test setup: a Map-backed localStorage, a fetch that serves public/ from disk, and the import.meta.env hook.
// Import this BEFORE dynamically importing anything from src/ that touches config.ts (api.ts, mock.ts).
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

register('./env-hook.mjs', import.meta.url);

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// quota: the longest value it will take, like a browser's storage limit (default: no limit).
export class MemoryStorage {
  private map = new Map<string, string>();
  private quota: number;
  constructor(quota = Infinity) {
    this.quota = quota;
  }
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    const s = String(v);
    if (s.length > this.quota) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    this.map.set(k, s);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

export const storage = new MemoryStorage();
export const useStorage = (s: MemoryStorage) =>
  Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true });
useStorage(storage);

// fetch('/mock/seed.json') -> public/mock/seed.json
export const fetched: string[] = [];
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const rel = url.replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0].replace(/^\/+/, '');
  fetched.push(rel);
  try {
    // The demo pile changes with the real items being filmed; tests use a frozen copy so they stay meaningful.
    const file = rel === 'mock/demo.json' ? path.join(ROOT, 'tests', 'fixtures', 'demo.json') : path.join(ROOT, 'public', rel);
    const text = await readFile(file, 'utf8');
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}) as typeof fetch;

export const readJson = async <T = unknown>(rel: string): Promise<T> => JSON.parse(await readFile(path.join(ROOT, rel), 'utf8')) as T;

// A tiny data URL that passes as a photo.
export const photo = (n: number) => `data:image/jpeg;base64,/9j/${'A'.repeat(8)}${n}`;
