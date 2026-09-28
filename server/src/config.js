// Loads .env (server/.env first, then the repo root .env) and exposes one config object.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..'); // server/

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
dotenv.config({ path: path.join(ROOT, '..', '.env'), quiet: true }); // never overrides the first

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const num = (k, d) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : d;
};

// "my-shop", "my-shop.myshopify.com" and "https://my-shop.myshopify.com/" all become "my-shop.myshopify.com"
function normaliseStore(s) {
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (s && !s.includes('.')) s += '.myshopify.com';
  return s;
}

export const config = {
  port: num('PORT', 8787),
  uiBase: env('UI_BASE').replace(/\/+$/, ''), // the UI's public URL for offer links; index.js warns when it's unset

  anthropicKey: env('ANTHROPIC_API_KEY'),
  anthropicModel: env('ANTHROPIC_MODEL', 'claude-sonnet-5'),

  openaiKey: env('OPENAI_API_KEY'),
  openaiModel: env('OPENAI_MODEL'), // empty = the fastest small vision model the key can see (gpt-5.4-nano first)
  // Estimate, grading, comps and descriptions run on OpenAI when there's no Anthropic key.
  openaiBrainModel: env('OPENAI_BRAIN_MODEL', 'gpt-5.4-mini'),

  geminiKey: env('GEMINI_API_KEY'),
  geminiModel: env('GEMINI_MODEL'), // empty = pick the fastest flash model the key can see

  tavilyKey: env('TAVILY_API_KEY'),

  shopifyStore: normaliseStore(env('SHOPIFY_STORE')),
  shopifyToken: env('SHOPIFY_ADMIN_TOKEN'),
  // Dev Dashboard apps: client id + secret mint a 24 h Admin token (client credentials grant) when there's no static token.
  shopifyClientId: env('SHOPIFY_CLIENT_ID'),
  shopifyClientSecret: env('SHOPIFY_CLIENT_SECRET'),
  shopifyApiVersion: env('SHOPIFY_API_VERSION', '2026-07'),

  supabaseUrl: env('SUPABASE_URL').replace(/\/+$/, ''),
  supabaseKey: env('SUPABASE_SERVICE_KEY'),
  bucket: env('SUPABASE_BUCKET', 'photos'),

  resetOnBoot: env('RESET_ON_BOOT') === '1',

  // Every runtime call has a short timeout and a plain fallback.
  timeouts: {
    live: num('LIVE_TIMEOUT_MS', 2500),
    estimate: num('ESTIMATE_TIMEOUT_MS', 22000),
    photos: num('PHOTOS_TIMEOUT_MS', 20000),
    text: num('TEXT_TIMEOUT_MS', 12000),
    comps: num('COMPS_TIMEOUT_MS', 10000),
    tavily: num('TAVILY_TIMEOUT_MS', 7000),
    shopify: num('SHOPIFY_TIMEOUT_MS', 10000),
    storage: num('STORAGE_TIMEOUT_MS', 10000),
  },
};

export const has = {
  claude: () => Boolean(config.anthropicKey),
  openai: () => Boolean(config.openaiKey),
  gemini: () => Boolean(config.geminiKey),
  tavily: () => Boolean(config.tavilyKey),
  shopify: () => Boolean(config.shopifyStore && (config.shopifyToken || (config.shopifyClientId && config.shopifyClientSecret))),
  supabase: () => Boolean(config.supabaseUrl && config.supabaseKey),
};
