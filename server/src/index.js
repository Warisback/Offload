// Boot: load state, load the demo cache, listen, then start the background services.
import { config, has } from './config.js';
import * as store from './store.js';
import * as demo from './demo.js';
import * as flows from './flows.js';
import * as gemini from './gemini.js';
import * as openai from './openai.js';
import * as claude from './claude.js';
import * as shopify from './shopify.js';
import * as storage from './storage.js';
import { createApp } from './app.js';
import { log, warn } from './util.js';

// A demo server stays up: log and carry on.
process.on('unhandledRejection', (e) => warn('Unhandled rejection:', e?.message || e));
process.on('uncaughtException', (e) => warn('Uncaught exception:', e?.stack || e));

const source = await store.load();
demo.loadCache();

const server = createApp().listen(config.port, () => {
  const on = (ok) => (ok ? 'on' : 'OFF');
  log(`offload backend on http://localhost:${config.port} (state from ${source}, saving to ${store.persistence()})`);
  log(`brain ${claude.provider()} | live prompts openai ${on(has.openai())} | gemini ${on(has.gemini())} | tavily ${on(has.tavily())} | shopify ${on(has.shopify())} | supabase ${on(store.persistence() === 'supabase')}`);
  if (!config.uiBase || config.uiBase.includes('<')) warn('UI_BASE is not set: Shopify offer links need the Vercel URL of the UI (see .env.example)');
  else log(`Offer links point at ${config.uiBase}/offer/<item_id>`);
});
server.on('error', (e) => {
  warn(`Could not listen on port ${config.port}: ${e.message}`);
  process.exit(1);
});

// Background services never block boot and never throw.
if (has.openai()) openai.init();
if (has.gemini()) gemini.init();
if (has.supabase()) storage.ensureBucket();
if (has.shopify()) {
  shopify
    .init()
    .then(() => shopify.startOrderPolling(flows.onOrder))
    .catch((e) => warn(`Shopify init failed: ${e.message}`));
}
flows.startShopifyRetry();

async function shutdown() {
  log('Saving and shutting down');
  await store.flush().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
