# offload backend: internal design

The contract in CLAUDE.md is law (the product was renamed from "Stash" to **offload**; user-facing strings say offload).
This file pins the *internal* module interfaces so every file fits together.
Plain JavaScript, ESM (`"type": "module"`), Node 24, Express 5. All money is integer pence.

## Decisions agreed with the frontend

- **Runner pay.** Pickup job `pay` = 600 x items ("£36 for this pickup"). Post job `pay` = 600 ("Post the Levi's jacket, £6").
  The ledger's `runner_amount` (600) is the same money seen from the sale side. Runner earnings must be computed from ONE
  source (the ledger for realised earnings, or pickup job pay for the promise), never pickup + post + ledger added together.
- **Post jobs** are created at sale time with `runner_name` = the runner who collected the pile and `status: "accepted"`
  (that runner already holds the item; the UI shows a "Posted" button that calls `/api/jobs/:id/done`). If no runner is
  known the job is `open`.
- **Claim close-up ordering.** The runner app sends `photos_b64` in the order front, back, label, marks..., **claim close-up last**.
  Claude picks `claim_proof` by looking at the photos; the order only matters in the fallback (no Claude), where the last
  photo of a multi-photo upload becomes `claim_proof` for items with a claim.
- **Discount codes** look like `OFFLOAD-7KQ2-X4F`. The buyer page can apply one with Shopify's shareable discount link:
  `https://<store>/discount/<CODE>?redirect=/products/<handle>` (handle = last path segment of `shopify_url`).
- **Events** come back oldest first; the UI reverses for a newest-first feed.
- **Negative platform revenue** is possible by the contract's own split on sales under £20 (70% + £6 exceeds the price).
  The backend reports the ledger truthfully; the demo items all sell above that line.

## Layout

```
server/
  CLAUDE.md            spec (verbatim)
  DESIGN.md            this file
  schema.sql           Supabase tables + bucket (paste into the SQL editor)
  .env.example
  mock/seed.json       full GET /api/state payload; the UI's mock file and the /reset state
  cache/demo.json      the Fleek demo pile, pre-computed (estimate, grades, comps, prices, descriptions)
  scripts/             one-off tools (validate seed, upload demo photos, smoke test)
  src/
    index.js           boot: load state, load cache, start order polling, listen
    app.js             Express app + all contract routes (no extra routes)
    config.js          env + timeouts            (done)
    util.js            ids, gbp(), withTimeout   (done)
    images.js          decodeB64, prepareImage   (done)
    db.js              shared supabase client    (done)
    store.js           in-memory state + Supabase write-through, event(), reset
    pricing.js         the pricing rule (pure)
    comps.js           comps cache + Tavily + Claude filter orchestration
    flows.js           shared business actions used by routes AND demo (grade, list, negotiate, recordSale...)
    demo.js            /api/demo/:step
    claude.js          Claude Sonnet calls (estimate, photo check, comps filter, descriptions)
    gemini.js          Gemini live-frame prompt
    tavily.js          Tavily search -> priced candidates
    shopify.js         Shopify Admin GraphQL (products, prices, discount codes, orders, demo order)
    storage.js         Supabase Storage uploads -> public URLs
```

## Shared helpers (already written)

- `config.js`: `config` (keys, `timeouts.{live,estimate,photos,text,comps,tavily,shopify,storage}` in ms, `uiBase`, `anthropicModel` default `claude-sonnet-5`, `geminiModel` default '' = auto, `shopifyStore` normalised to `x.myshopify.com`, `shopifyApiVersion` default `2026-07`, `bucket` default `photos`), `has.{claude,gemini,tavily,shopify,supabase}()`, `ROOT` (= server/).
- `util.js`: `id(prefix)`, `nowIso()`, `sleep(ms)`, `gbp(pence)` ("£38", "£26.60"), `roundPounds(p)`, `toPence(v)`, `withTimeout(promise, ms, label)` (rejects `TimeoutError`), `TimeoutError`, `log(...)`, `warn(...)`, `clip(s,n)`, `norm(s)`.
- `images.js`: `decodeB64(input)` -> `{buffer, mediaType}`; `prepareImage(input, {maxEdge=1568, quality=80})` -> `{buffer, data /*base64, no prefix*/, mediaType}` (JPEG via sharp, EXIF-rotated); `sample(list, n)`.
- `db.js`: `supabase` (client or `null`).

## Error/fallback convention

Adapters (`claude.js`, `gemini.js`, `tavily.js`, `shopify.js`, `storage.js`) **throw** on failure, timeout or missing key
(`new Error('not configured')`). They enforce their own timeout from `config.timeouts` with AbortController/`withTimeout`
so no request dangles. Callers (flows/routes) catch and apply the plain fallback. Adapters never write events or state.
Adapters log one short line per failure with `warn()`; never log keys or base64.

## Internal fields (not in the contract)

Items carry `item.meta` (persisted in an extra `meta jsonb` column, **stripped from GET /api/state**):

```
meta = {
  brand_tier: 'designer'|'premium'|'high street'|'unknown',
  type_label: 'denim trucker jacket',        // free-text type for search/descriptions (item.type is the table key)
  search_query: '90s embroidered denim jacket patches',  // description search when no brand
  claim_noun: 'the signature',               // for "Close-up of the signature included."
  claim_line: "Seller says it's signed by Kobe Bryant. Close-up of the signature included.",
  story_safe: '...',                         // seller_story with the claim removed (used when there is no claim_proof)
  proof_note: '...',                         // note the seller sent with proof
  demo_key: 'levis-trucker' | null,          // links to cache/demo.json item
  demo: true|false,                          // created by /api/demo/estimate
  retake_rounds: 0,
  shopify_product_id, shopify_variant_id, shopify_handle,
  asked_price_event: bool, comps_warned: bool, claim_off_told: bool,
}
```

`item.type` is always one of the table keys: `jacket | jeans | hoodie | t-shirt | dress | trainers | other`.

## Adapter interfaces

### claude.js (Claude Sonnet via `@anthropic-ai/sdk`, model `config.anthropicModel`)

All calls: `thinking: {type: 'disabled'}` for latency, `output_config: { effort: 'low', format: { type: 'json_schema', schema } }`
(structured outputs; every object schema has `additionalProperties: false` and lists all keys in `required`; nullable = `type: ['string','null']`),
base64 image blocks `{type:'image', source:{type:'base64', media_type, data}}` placed before the text block, SDK `timeout` + `maxRetries: 0`
plus `withTimeout`. Parse the first `text` block as JSON. Check `stop_reason` (`refusal`/`max_tokens` -> throw).

```
estimatePile({ frames: [{data, mediaType}], transcript, sellerName }) -> Promise<{ items: [{
  label, brand|null, type /*table key*/, type_label, size|null,
  brand_tier, condition_notes: [string], special|null,
  claim|null            // short phrase that reads after "it's": "signed by Kobe Bryant", "hand-painted by my sister"
  claim_noun|null       // "the signature", "the painted back"
  claim_line|null       // "Seller says it's signed by Kobe Bryant. Close-up of the signature included."
  seller_ask|null       // integer pence ("I want £80" -> 8000)
  seller_story|null     // what the seller said about THIS item, cleaned up, in their words, first person kept
  story_safe|null       // same story with the claim taken out (null if no claim)
  proof_request|null    // "You said it's signed by Kobe Bryant. Do you have a photo of it being signed, a receipt or a certificate?"
  search_query          // brand+type+size if branded, else era/style/material/features
}] }>

checkPhotos({ item: {label, brand, type, size, claim, claim_noun, condition_notes, seller_story, special},
              photos: [{data, mediaType}], lenient /*bool: after 2 retake rounds only flag truly unusable*/ })
  -> Promise<{
    photo_requests: [string],   // plain runner instructions; [] when good enough
    request_summary|null,       // "a clearer shot of the signature" (fits "Asked the runner for ___.")
    grade: 'A'|'B'|'C'|'D',
    condition_notes: [string],  // honest, specific, short
    special|null,
    claim_proof_index: int|null,// index into photos of the claim close-up, if one is clear
    brand|null, size|null       // read from label/size tag when visible (null = keep existing)
  }>

filterComps({ query, item: {label, brand, type_label, size}, candidates: [{source,title,price,url,snippet}] })
  -> Promise<{ matches: [{ index, price }] }>   // close matches only, price in pence corrected from snippet if needed, best first, max 5

writeDescription({ label, brand, size, type_label, grade, condition_notes, special, story /*already claim-safe*/,
                   proof_note|null, has_proof: bool })
  -> Promise<{ title, body, proof_line|null }>
  // body: 2-3 short plain paragraphs separated by \n\n: seller's story first (their details/history), then condition stated honestly.
  // Never mentions any claim, the offer link, price, "AI". proof_line e.g. "Seller has shared a photo from the signing." only when has_proof.
```

### gemini.js (Gemini REST, `x-goog-api-key` header, `fetch`)

```
PROMPTS  // the fixed list of 10 strings from CLAUDE.md, exported
init() -> Promise<string|null>   // picks config.geminiModel or the fastest flash model visible to the key (ListModels), warms it; never throws
livePrompt({ frame: {data, mediaType}, transcript, previousPrompt, timeoutMs }) -> Promise<{ prompt, notes }>
  // prompt MUST be one of PROMPTS (responseSchema enum + validation, else throw). notes: one short line.
  // Aborts the fetch at timeoutMs. Throws on timeout/error; the route returns the previous prompt.
```

### tavily.js

```
searchComps(query, { timeoutMs }) -> Promise<[{ source, title, price /*pence|null*/, url, snippet }]>
  // POST https://api.tavily.com/search, public results only, include_domains: ebay.co.uk, ebay.com, depop.com,
  // marketplace.asos.com, vestiairecollective.com. source = "eBay" | "Depop" | "ASOS Marketplace" | "Vestiaire Collective".
  // price parsed from title/snippet (£ first; $ and € converted roughly), null if none. Dedupe by url.
SOURCE_DOMAINS  // exported
```

### shopify.js (Admin GraphQL, `X-Shopify-Access-Token`, `config.shopifyApiVersion`)

```
isConfigured() -> bool
init() -> Promise<void>        // shop currency + Online Store publication id (best effort), baseline existing orders as seen; never throws
createProduct({ itemId, title, descriptionHtml, images: [url], price /*pence*/, tags: [string] })
  -> Promise<{ productId, variantId, handle, url }>   // ACTIVE, published to Online Store when possible, url = https://<store>/products/<handle>
updatePrice({ productId, variantId, price }) -> Promise<void>
updateProduct({ productId, descriptionHtml?, images?: [url] }) -> Promise<void>   // images are appended
markSold({ productId, variantId }) -> Promise<void>   // stock tracked + inventoryPolicy DENY: storefront shows "Sold out"
createDiscountCode({ code, productId, amountOff /*pence*/, title }) -> Promise<{ code, id }>  // one use, that product only
createDemoOrder({ variantId, discountAmount /*pence*/, email? }) -> Promise<{ orderId, name }>  // draft order -> complete (paid)
startOrderPolling(onOrder) -> void   // every 5s; for each NEW order since boot:
  // onOrder({ orderId, name, createdAt, shipTo /*"London E1 6AN"|null*/, lines: [{ productId, variantId, quantity, salePrice /*pence after discounts*/ }] })
  // errors are logged, never thrown; onOrder errors are caught
stopOrderPolling()
```

### storage.js

```
uploadImages(b64List, folder) -> Promise<[url]>   // prepareImage(maxEdge 1600) then upload to bucket, public URLs
uploadBuffer(buffer, path, contentType) -> Promise<url>
ensureBucket() -> Promise<void>   // create public bucket `photos` if missing; never throws
// Fallback when Supabase is missing/failing: throws; the caller decides (flows fall back to data URLs so the demo never dies).
```

## Core (store / pricing / comps / flows)

### store.js

```
state = { pickups: [], items: [], jobs: [], offers: [], ledger: [], events: [] }
load() -> Promise   // Supabase if configured and not empty, else seed (and write seed to Supabase)
publicState() -> contract payload (items without meta, events in time order)
find(kind, id) / itemsOf(pickupId) / add(kind, row) / save(kind, row)  // save marks dirty; flushed to Supabase every 500 ms
event(actor, text, money = null) -> Event
reset() -> Promise  // memory back to seed, Supabase rows replaced by seed
```

### pricing.js (pure)

```
TYPE_BASE, BRAND_TIER, GRADE_MULT
priceItem({ type, brand_tier, grade /*null = assume B*/, special, seller_ask, comps: [{price}] })
  -> { list_price, floor_price, price_source, price_confidence, market /*grade-adjusted comps price or null*/,
       noMatches: bool, askAboveMarket: bool }
previewRange({ type, brand_tier, special, seller_ask, comps }) -> { low, high }
```

## Demo cache format (cache/demo.json)

```
{
  "seller_name": "Maya", "address": "...", "runner_name": "Sam",
  "transcript": "full seller transcript while filming",
  "items": [{
    "key": "levis-trucker",
    "match": ["levi", "trucker"],             // lowercase words; a live item matches when all appear in its label+brand
    "label", "brand", "type", "type_label", "size", "brand_tier",
    "seller_story", "story_safe", "claim", "claim_noun", "claim_line", "seller_ask", "proof_request",
    "search_query",
    "estimate_notes": [string],               // condition notes visible in the video
    "grade", "condition_notes", "special",
    "photos": [url], "claim_proof": url|null,
    "retake": null | { "photo_requests": [string], "request_summary": "a clearer shot of the signature",
                       "photos_after": [url], "claim_proof": url },
    "comps": [{ "source", "title", "price", "url" }],
    "description": { "title", "body", "proof_line": null }
  }],
  "sale": { "item_key": "levis-trucker", "buyer": "Grok Bot", "first_offer": 2800, "discount_code": "STASH-LEVI-33" }
}
```

Prices are NOT stored in the cache; they are computed by pricing.js from comps/grade/ask so the cache can never disagree with the rule.
