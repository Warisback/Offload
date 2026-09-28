// Shopify Admin GraphQL: products, prices, discount codes, order polling, demo orders.
//
// Required app scopes: write_products, read_products, write_discounts, read_orders,
// write_draft_orders, read_publications, write_publications.
//
// Shapes checked against shopify.dev admin-graphql 2026-07: productCreate(product, media),
// productUpdate(product, media) (productCreateMedia is deprecated), productVariantsBulkUpdate,
// publishablePublish, discountCodeBasicCreate with context {all: ALL} (customerSelection is
// deprecated), draftOrderCreate + draftOrderComplete(id) (paymentPending is deprecated, default = paid).
import { config, has } from './config.js';
import { log, warn, sleep, clip } from './util.js';

const FALLBACK_VERSIONS = ['2025-10', '2025-07'];
const POLL_MS = 5000;
const BOOT_MS = Date.now();
// Orders from a minute before boot, to absorb clock skew; the baseline stops them replaying.
const ORDERS_SINCE = new Date(BOOT_MS - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

let version = config.shopifyApiVersion;
let versionSettled = false;
let currency = null;
let onlineStoreId = null;
let publicationLookedUp = false;
let publicationLookup = null;
let publishWarned = false;
let eligibility = 'context'; // or 'customerSelection' on older API versions
let orderAddress = true; // dropped if the app can't read shipping addresses

const seenOrders = new Set();
let baselined = false;
let pollTimer = null;
let polling = false;
let pollError = null;

export const isConfigured = () => has.shopify();

// ---------- transport ----------

const endpoint = (v) => `https://${config.shopifyStore}/admin/api/${v}/graphql.json`;
const timeoutError = () => new Error(`shopify timed out after ${config.timeouts.shopify}ms`);

// Static SHOPIFY_ADMIN_TOKEN if set, else a 24 h token from the client credentials grant (Dev Dashboard app
// installed on a store in the same organisation), cached and re-minted 10 minutes before it expires.
let minted = null; // { token, expiresAt }
let minting = null;
async function accessToken() {
  if (config.shopifyToken) return config.shopifyToken;
  if (minted && minted.expiresAt - Date.now() > 10 * 60 * 1000) return minted.token;
  minting ||= (async () => {
    const res = await fetch(`https://${config.shopifyStore}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.shopifyClientId, client_secret: config.shopifyClientSecret }),
      signal: AbortSignal.timeout(config.timeouts.shopify),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    if (!res.ok || !json?.access_token) {
      throw new Error(`shopify token: HTTP ${res.status} ${String(json?.error_description || json?.error || text).replace(/\s+/g, ' ').slice(0, 140)}`);
    }
    minted = { token: json.access_token, expiresAt: Date.now() + (Number(json.expires_in) || 86399) * 1000 };
    log(`Shopify token minted (scopes: ${json.scope || 'unknown'})`);
    return minted.token;
  })().finally(() => (minting = null));
  return minting;
}

// One HTTP attempt, aborted at the shared deadline so nothing dangles.
async function post(v, body, deadline) {
  const ms = deadline - Date.now();
  if (ms <= 0) throw timeoutError();
  const token = await accessToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(endpoint(v), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (res.status === 401 && !config.shopifyToken) minted = null; // re-mint on the next call
    return { status: res.status, headers: res.headers, text };
  } catch (e) {
    if (ctrl.signal.aborted) throw timeoutError();
    throw new Error(`shopify request failed: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// Sends with the working API version; a 404 on the first call tries older versions once.
async function send(body, deadline) {
  let res = await post(version, body, deadline);
  if (res.status === 404 && !versionSettled) {
    for (const v of FALLBACK_VERSIONS.filter((x) => x !== version)) {
      const r = await post(v, body, deadline);
      if (r.status === 404) continue;
      log(`shopify: API ${version} not found, using ${v}`);
      version = v;
      res = r;
      break;
    }
  }
  if (res.status !== 404) {
    versionSettled = true;
    noteServedVersion(res.headers);
  }
  return res;
}

// Shopify falls forward to the oldest supported version and says so in this header.
function noteServedVersion(headers) {
  const served = headers?.get?.('x-shopify-api-version');
  if (served && served !== version) {
    log(`shopify: asked for API ${version}, served ${served}; using ${served}`);
    version = served;
  }
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Milliseconds to wait before one retry, or null when the call wasn't throttled.
function throttleWait(res, json) {
  if (res.status === 429) {
    const s = Number(res.headers?.get?.('retry-after'));
    return Number.isFinite(s) && s > 0 ? s * 1000 : 1000;
  }
  const throttled = Array.isArray(json?.errors) && json.errors.some((e) => e?.extensions?.code === 'THROTTLED');
  if (!throttled) return null;
  const cost = json.extensions?.cost;
  const status = cost?.throttleStatus;
  if (!status?.restoreRate) return 1000;
  const need = (cost.requestedQueryCost ?? 0) - (status.currentlyAvailable ?? 0);
  return Math.min(3000, Math.max(500, Math.ceil((need / status.restoreRate) * 1000)));
}

function httpError(res, json) {
  const hints = {
    401: 'check SHOPIFY_ADMIN_TOKEN',
    402: 'shop is frozen',
    403: 'forbidden',
    404: `check SHOPIFY_STORE (${config.shopifyStore})`,
    423: 'shop is locked',
  };
  const detail = hints[res.status] || clip(typeof json?.errors === 'string' ? json.errors : '', 120);
  return new Error(`shopify HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
}

function gqlError(errors) {
  const err = new Error(`shopify: ${clip(errors.map((e) => e?.message || 'error').join('; '), 240)}`);
  err.code = errors.find((e) => e?.extensions?.code)?.extensions.code || null;
  return err;
}

// Runs one query or mutation and returns `data`. Throws on HTTP errors, GraphQL errors or timeout.
async function gql(query, variables = {}) {
  if (!isConfigured()) throw new Error('not configured');
  const deadline = Date.now() + config.timeouts.shopify;
  const body = JSON.stringify({ query, variables });
  for (let attempt = 0; ; attempt++) {
    const res = await send(body, deadline);
    const json = parse(res.text);
    const wait = throttleWait(res, json);
    if (wait != null && attempt === 0 && Date.now() + wait < deadline) {
      await sleep(wait);
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw httpError(res, json);
    if (Array.isArray(json?.errors) && json.errors.length) throw gqlError(json.errors);
    if (!json?.data) throw new Error('shopify: empty response');
    return json.data;
  }
}

// Throws with Shopify's own messages when a mutation reports userErrors.
function checkUserErrors(payload, label) {
  if (!payload) throw new Error(`${label}: no result`);
  const errs = payload.userErrors || [];
  if (!errs.length) return;
  const err = new Error(`${label}: ${clip(errs.map((e) => e.message).join('; '), 240)}`);
  err.userErrors = errs;
  throw err;
}

// Logs one short line per failed call, then rethrows for the caller's fallback.
async function run(label, fn) {
  try {
    return await fn();
  } catch (e) {
    warn(`shopify ${label} failed: ${e.message}`);
    throw e;
  }
}

// ---------- money, media ----------

// 3800 -> "38.00" (shop currency). Every amount we send must be positive.
function toMoney(pence) {
  const p = Math.round(Number(pence));
  if (!Number.isFinite(p) || p <= 0) throw new Error(`bad amount: ${pence}`);
  return (p / 100).toFixed(2);
}

const toPence = (amount) => Math.round(Number(amount || 0) * 100) || 0;

// Shopify can only ingest public http(s) URLs; data: URLs are skipped.
function mediaInput(urls, alt) {
  const list = (urls || []).filter((u) => typeof u === 'string');
  const ok = list.filter((u) => /^https?:\/\//i.test(u));
  if (ok.length < list.length) warn(`shopify: skipped ${list.length - ok.length} non-http image(s)`);
  return ok.map((u) => ({ originalSource: u, mediaContentType: 'IMAGE', ...(alt ? { alt: clip(alt, 200) } : {}) }));
}

// ---------- init ----------

const SHOP_Q = `query OffloadShop { shop { name currencyCode } }`;

// `name` is deprecated on Publication but still served; the catalog title is the fallback.
const PUBLICATIONS_Q = `query OffloadPublications { publications(first: 25) { nodes { id name } } }`;
const PUBLICATIONS_CATALOG_Q = `query OffloadPublications { publications(first: 25) { nodes { id catalog { title } } } }`;

const isAccessDenied = (e) => e?.code === 'ACCESS_DENIED' || /access denied|required access|scope/i.test(e?.message || '');

function warnPublishOnce(msg) {
  if (publishWarned) return;
  publishWarned = true;
  warn(`shopify: ${msg}; products stay unpublished from the Online Store`);
}

// Settles on found / not found / no scope. A timeout or network blip is retried on the next
// listing, so one bad moment at boot doesn't leave every product off the storefront.
async function findOnlineStore() {
  const isOnlineStore = (n) => /online store/i.test(n?.name || n?.catalog?.title || '');
  try {
    let nodes;
    try {
      nodes = (await gql(PUBLICATIONS_Q)).publications?.nodes || [];
    } catch (e) {
      if (isAccessDenied(e) || !/field|name/i.test(e.message)) throw e;
      nodes = (await gql(PUBLICATIONS_CATALOG_Q)).publications?.nodes || [];
    }
    onlineStoreId = nodes.find(isOnlineStore)?.id || null;
    publicationLookedUp = true;
    if (!onlineStoreId) warnPublishOnce('no Online Store publication found');
  } catch (e) {
    if (isAccessDenied(e)) {
      publicationLookedUp = true;
      warnPublishOnce('no read_publications scope');
    } else {
      warn(`shopify: publication lookup failed, will retry: ${e.message}`);
    }
  }
}

// Parallel listings share one in-flight lookup.
function lookUpOnlineStore() {
  publicationLookup ??= findOnlineStore().finally(() => (publicationLookup = null));
  return publicationLookup;
}

export async function init() {
  if (!isConfigured()) {
    log('shopify: not configured, skipping');
    return;
  }
  try {
    const { shop } = await gql(SHOP_Q);
    currency = shop?.currencyCode || null;
    log(`shopify: ${shop?.name} (${currency}), API ${version}`);
    if (currency && currency !== 'GBP') warn(`shopify: shop currency is ${currency}, not GBP; prices are sent unconverted`);
  } catch (e) {
    warn(`shopify init: shop lookup failed: ${e.message}`);
  }
  await lookUpOnlineStore();
  try {
    for (const node of await fetchRecentOrders()) seenOrders.add(node.id);
    baselined = true;
    log(`shopify: ${seenOrders.size} existing order(s) marked as seen`);
  } catch (e) {
    warn(`shopify init: order baseline failed: ${e.message}`);
  }
}

// ---------- products ----------

const PRODUCT_CREATE = `mutation OffloadProductCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
  productCreate(product: $product, media: $media) {
    product { id handle variants(first: 1) { nodes { id } } }
    userErrors { field message }
  }
}`;

const VARIANTS_UPDATE = `mutation OffloadVariantsUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id price }
    userErrors { field message }
  }
}`;

const PUBLISH = `mutation OffloadPublish($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) { userErrors { field message } }
}`;

const PRODUCT_DELETE = `mutation OffloadProductDelete($input: ProductDeleteInput!) {
  productDelete(input: $input) { deletedProductId userErrors { field message } }
}`;

const PRODUCT_UPDATE = `mutation OffloadProductUpdate($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
  productUpdate(product: $product, media: $media) {
    product { id }
    userErrors { field message }
  }
}`;

const DEFAULT_VARIANT_Q = `query OffloadDefaultVariant($id: ID!) { product(id: $id) { variants(first: 1) { nodes { id } } } }`;

const productUrl = (handle) => `https://${config.shopifyStore}/products/${handle}`;

async function updateVariant(productId, variant) {
  const data = await gql(VARIANTS_UPDATE, { productId, variants: [variant] });
  checkUserErrors(data.productVariantsBulkUpdate, 'productVariantsBulkUpdate');
}

async function defaultVariantId(productId) {
  const data = await gql(DEFAULT_VARIANT_Q, { id: productId });
  const id = data.product?.variants?.nodes?.[0]?.id;
  if (!id) throw new Error('product has no variant');
  return id;
}

// Best effort: never leave a live £0 product behind when pricing fails.
async function deleteQuietly(productId) {
  try {
    const data = await gql(PRODUCT_DELETE, { input: { id: productId } });
    checkUserErrors(data.productDelete, 'productDelete');
  } catch (e) {
    warn(`shopify: could not remove unpriced product ${productId}: ${e.message}`);
  }
}

async function publish(productId) {
  if (!publicationLookedUp) await lookUpOnlineStore();
  if (!onlineStoreId) return;
  try {
    const data = await gql(PUBLISH, { id: productId, input: [{ publicationId: onlineStoreId }] });
    checkUserErrors(data.publishablePublish, 'publishablePublish');
  } catch (e) {
    if (isAccessDenied(e)) {
      onlineStoreId = null;
      warnPublishOnce('no write_publications scope');
    } else {
      warn(`shopify: publish failed: ${e.message}`);
    }
  }
}

export function createProduct({ itemId, title, descriptionHtml, images, price, tags, vendor, brand }) {
  return run('createProduct', async () => {
    const amount = toMoney(price);
    const product = {
      title,
      descriptionHtml: descriptionHtml || '',
      status: 'ACTIVE',
      tags: [...(tags || []), ...(itemId ? [`offload-${itemId}`] : [])],
    };
    if (vendor || brand) product.vendor = vendor || brand;
    const media = mediaInput(images, title);

    const data = await gql(PRODUCT_CREATE, { product, media: media.length ? media : null });
    const payload = data.productCreate;
    const created = payload?.product;
    if (!created?.id) {
      checkUserErrors(payload, 'productCreate');
      throw new Error('productCreate: no product returned');
    }
    // The product exists; media problems alone shouldn't cause a duplicate on retry.
    if (payload.userErrors?.length) warn(`shopify: productCreate: ${clip(payload.userErrors.map((e) => e.message).join('; '), 160)}`);

    const productId = created.id;
    const variantId = created.variants?.nodes?.[0]?.id;
    try {
      if (!variantId) throw new Error('product has no variant');
      // CONTINUE keeps a one-off item buyable even when the default variant tracks stock at 0.
      await updateVariant(productId, { id: variantId, price: amount, inventoryPolicy: 'CONTINUE' });
    } catch (e) {
      await deleteQuietly(productId);
      throw e;
    }
    await publish(productId);
    return { productId, variantId, handle: created.handle, url: productUrl(created.handle) };
  });
}

export function updatePrice({ productId, variantId, price }) {
  return run('updatePrice', async () => {
    const amount = toMoney(price);
    const id = variantId || (await defaultVariantId(productId));
    await updateVariant(productId, { id, price: amount });
  });
}

// Sold: stock is tracked (none on hand) and overselling is off, so the storefront shows "Sold out" and the link keeps working.
export function markSold({ productId, variantId }) {
  return run('markSold', async () => {
    const id = variantId || (await defaultVariantId(productId));
    await updateVariant(productId, { id, inventoryPolicy: 'DENY', inventoryItem: { tracked: true } });
  });
}

// Images are appended; productUpdate's media argument adds new media to the product.
export function updateProduct({ productId, descriptionHtml, images } = {}) {
  return run('updateProduct', async () => {
    const media = mediaInput(images);
    if (descriptionHtml == null && !media.length) return;
    const product = { id: productId };
    if (descriptionHtml != null) product.descriptionHtml = descriptionHtml;
    const data = await gql(PRODUCT_UPDATE, { product, media: media.length ? media : null });
    checkUserErrors(data.productUpdate, 'productUpdate');
  });
}

// ---------- discount codes ----------

const DISCOUNT_CREATE = `mutation OffloadDiscount($discount: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $discount) {
    codeDiscountNode { id }
    userErrors { field message }
  }
}`;

const ELIGIBILITY = {
  context: { context: { all: 'ALL' } },
  customerSelection: { customerSelection: { all: true } },
};

const mentionsEligibility = (e) =>
  /\bcontext\b|customerSelection|customer selection/i.test(e.message) ||
  (e.userErrors || []).some((u) => (u.field || []).some((f) => f === 'context' || f === 'customerSelection'));

async function createDiscount(base, mode) {
  const data = await gql(DISCOUNT_CREATE, { discount: { ...base, ...ELIGIBILITY[mode] } });
  checkUserErrors(data.discountCodeBasicCreate, 'discountCodeBasicCreate');
  return data.discountCodeBasicCreate.codeDiscountNode?.id || null;
}

// One use, that product only, fixed amount off once per order.
export function createDiscountCode({ code, productId, amountOff, title }) {
  return run('createDiscountCode', async () => {
    const base = {
      title: title || `Agreed offer ${code}`,
      code,
      startsAt: new Date(Date.now() - 60_000).toISOString(), // a minute back so it works the instant it's shared
      usageLimit: 1,
      appliesOncePerCustomer: true,
      customerGets: {
        value: { discountAmount: { amount: toMoney(amountOff), appliesOnEachItem: false } },
        items: { products: { productsToAdd: [productId] } },
      },
    };
    try {
      return { code, id: await createDiscount(base, eligibility) };
    } catch (e) {
      if (!mentionsEligibility(e)) throw e;
      const other = eligibility === 'context' ? 'customerSelection' : 'context';
      const id = await createDiscount(base, other);
      log(`shopify: discount eligibility switched to ${other}`);
      eligibility = other;
      return { code, id };
    }
  });
}

// ---------- demo order ----------

const DRAFT_CREATE = `mutation OffloadDraftCreate($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) { draftOrder { id } userErrors { field message } }
}`;

const DRAFT_COMPLETE = `mutation OffloadDraftComplete($id: ID!) {
  draftOrderComplete(id: $id) { draftOrder { id order { id name } } userErrors { field message } }
}`;

const DRAFT_ORDER_Q = `query OffloadDraftOrder($id: ID!) { draftOrder(id: $id) { order { id name } } }`;

async function createDraft(input) {
  const data = await gql(DRAFT_CREATE, { input });
  checkUserErrors(data.draftOrderCreate, 'draftOrderCreate');
  return data.draftOrderCreate.draftOrder.id;
}

// Draft orders finish calculating asynchronously, so completing can briefly say "not ready".
async function completeDraft(id) {
  for (let attempt = 0; ; attempt++) {
    try {
      const data = await gql(DRAFT_COMPLETE, { id });
      checkUserErrors(data.draftOrderComplete, 'draftOrderComplete');
      return data.draftOrderComplete.draftOrder?.order || null;
    } catch (e) {
      if (attempt >= 2 || !e.userErrors || !/ready|calculat|processing/i.test(e.message)) throw e;
      await sleep(800);
    }
  }
}

async function waitForOrder(id) {
  for (let i = 0; i < 5; i++) {
    await sleep(800);
    const order = (await gql(DRAFT_ORDER_Q, { id })).draftOrder?.order;
    if (order?.id) return order;
  }
  throw new Error('draft order completed but no order appeared');
}

// Line-level discount so it lands in that line's discountAllocations, like a discount code would.
export function createDemoOrder({ variantId, discountAmount, email }) {
  return run('createDemoOrder', async () => {
    if (!variantId) throw new Error('no variant id');
    const off = Math.round(Number(discountAmount) || 0);
    const line = { variantId, quantity: 1 };
    if (off > 0) line.appliedDiscount = { valueType: 'FIXED_AMOUNT', value: off / 100, title: 'Agreed offer' };
    const input = { lineItems: [line], email: email || 'grok-bot@example.com', note: 'offload demo sale' };

    let draftId;
    try {
      draftId = await createDraft(input);
    } catch (e) {
      // Apps without protected customer data access can't set an email; the sale matters more.
      if (!/email|approved|protected/i.test(e.message)) throw e;
      delete input.email;
      draftId = await createDraft(input);
    }
    const order = (await completeDraft(draftId)) || (await waitForOrder(draftId));
    return { orderId: order.id, name: order.name };
  });
}

// ---------- order polling ----------

// Nested connections multiply in Shopify's query cost and one query may not exceed 1000 points:
// 25 orders x 50 lines requested ~10k and was refused outright. 10 x 5 is about 450
// (2 + 10 x (order + address + 2 + 5 x ~8 per line)). A pile is a handful of one-off items.
function ordersQuery(withAddress) {
  return `query OffloadOrders($q: String!) {
  orders(first: 10, sortKey: CREATED_AT, reverse: true, query: $q) {
    nodes {
      id name createdAt
      ${withAddress ? 'shippingAddress { city zip }' : ''}
      lineItems(first: 5) {
        nodes {
          quantity
          variant { id }
          product { id }
          originalTotalSet { shopMoney { amount } }
          discountAllocations { allocatedAmountSet { shopMoney { amount } } }
        }
      }
    }
  }
}`;
}

async function fetchRecentOrders() {
  const vars = { q: `created_at:>='${ORDERS_SINCE}'` };
  try {
    return (await gql(ordersQuery(orderAddress), vars)).orders?.nodes || [];
  } catch (e) {
    // Shipping addresses are protected customer data; poll without them rather than not at all.
    if (!orderAddress || !/shipping|address|approved|protected/i.test(e.message)) throw e;
    orderAddress = false;
    warn('shopify: no access to order addresses, polling without shipTo');
    return (await gql(ordersQuery(false), vars)).orders?.nodes || [];
  }
}

function toLine(li) {
  const original = toPence(li.originalTotalSet?.shopMoney?.amount);
  const off = (li.discountAllocations || []).reduce((sum, d) => sum + toPence(d.allocatedAmountSet?.shopMoney?.amount), 0);
  return {
    productId: li.product?.id ?? null,
    variantId: li.variant?.id ?? null,
    quantity: li.quantity ?? 1,
    salePrice: Math.max(0, original - off),
  };
}

function toOrder(node) {
  const a = node.shippingAddress;
  return {
    orderId: node.id,
    name: node.name,
    createdAt: node.createdAt,
    shipTo: [a?.city, a?.zip].filter(Boolean).join(' ') || null,
    lines: (node.lineItems?.nodes || []).map(toLine),
  };
}

async function pollOnce(onOrder) {
  if (polling) return; // previous poll still running
  polling = true;
  try {
    const nodes = await fetchRecentOrders();
    if (pollError) log('shopify: order polling recovered');
    pollError = null;
    for (const node of nodes.slice().reverse()) {
      if (seenOrders.has(node.id)) continue;
      seenOrders.add(node.id);
      // Without an init baseline, anything from before boot counts as old.
      if (!baselined && Date.parse(node.createdAt) < BOOT_MS) continue;
      try {
        await onOrder(toOrder(node));
      } catch (e) {
        warn(`shopify: order ${node.name} handler failed: ${e.message}`);
      }
    }
    baselined = true;
  } catch (e) {
    if (e.message !== pollError) warn(`shopify: order poll failed: ${e.message}`);
    pollError = e.message;
  } finally {
    polling = false;
  }
}

export function startOrderPolling(onOrder) {
  stopOrderPolling();
  if (!isConfigured()) {
    log('shopify: not configured, order polling off');
    return;
  }
  pollTimer = setInterval(() => pollOnce(onOrder), POLL_MS);
  pollTimer.unref?.();
}

export function stopOrderPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
