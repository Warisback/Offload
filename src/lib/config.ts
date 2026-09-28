// Where the API lives. Build-time env first, then a runtime override that survives reloads:
//   ?api=https://abc.ngrok-free.app   point this browser at a backend (saved)
//   ?api=mock                         use the in-browser mock (saved)
//   ?api=clear                        forget the override
// The override lets the deployed Vercel site follow a fresh ngrok URL without a redeploy,
// and the runner QR code carries it so judges' phones hit the same backend.

const KEY = 'offload.api';
const env: Partial<ImportMetaEnv> = import.meta.env ?? {}; // Node (tests) has no import.meta.env

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function writeStored(v: string | null) {
  try {
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the override just lasts for this page load */
  }
}

const clean = (u: string) => u.trim().replace(/\/+$/, '');

function resolve() {
  let override: string | null = readStored();
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    const q = url.searchParams.get('api');
    if (q !== null) {
      override = q === 'clear' || q === '' ? null : q === 'mock' ? 'mock' : clean(q);
      writeStored(override);
      url.searchParams.delete('api');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
  }
  const envBase = env.VITE_API_BASE ? clean(String(env.VITE_API_BASE)) : '';
  const envMock = String(env.VITE_USE_MOCK ?? '').toLowerCase() === 'true';
  if (override === 'mock') return { mock: true, base: '', override };
  if (override) return { mock: false, base: override, override };
  if (envMock || !envBase) return { mock: true, base: '', override: null };
  return { mock: false, base: envBase, override: null };
}

const resolved = resolve();

export const USE_MOCK: boolean = resolved.mock;
export const API_BASE: string = resolved.base;
export const API_OVERRIDE: string | null = resolved.override;

// The public origin judges' phones can reach (never localhost on the projector).
export const PUBLIC_URL: string = clean(String(env.VITE_PUBLIC_URL || (typeof window !== 'undefined' ? window.location.origin : '')));

export function runnerLink(): string {
  const base = `${PUBLIC_URL}/runner`;
  return API_OVERRIDE ? `${base}?api=${encodeURIComponent(API_OVERRIDE)}` : base;
}

export const isLocalOrigin = (u: string) => /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/.test(u);

export const POLL_MS = 1500;

// The Shopify development store is password protected; the buyer page shows this next to the checkout link.
export const SHOP_PASSWORD: string = String(env.VITE_SHOP_PASSWORD || '').trim();
