# CLAUDE.md: Stash backend (working name)

## Context
One-day hackathon: Grok Bot Commerce London at Fleek HQ, Saturday 26 Sept 2026. Solo builder.
Feature freeze 14:30. Submit 15:45. Code freeze 16:30. Live demo at 17:30.
A separate agent (Astra) builds the UI to the exact same contract below. You build only the backend.

## What the product does
People bin clothes because selling them is a chore. With Stash you film your pile and talk about it. The agent tells you what to expect, books a vetted local runner who collects it and photographs each item, then the agent grades, prices, lists, negotiates with buyers (including AI shopping bots) and books the runner to post each sale. The seller does nothing after the video.

Judges: Fleek (secondhand wholesale marketplace), Wassist, Huge, Episode 1 Ventures, Entrepreneurs First. They score real commerce depth, meaningful agent use, execution, originality and business value. Real integrations beat fake ones.

## CONTRACT (law: identical in CLAUDE.md and ASTRA.md; change both or neither)

All money is in pence (integer). All ids are short strings. All photos are public URLs (Supabase Storage).

### Shapes

Pickup {
  id, seller_name, address,
  transcript,                       // what the seller said while filming
  estimate_low, estimate_high,      // pence, whole pile
  preview: [{ label, low, high }],  // one per item spotted in the video
  status: "estimated" | "booked" | "collected" | "listed",
  runner_name | null,
  created_at
}

Item {
  id, pickup_id,
  label,                            // e.g. "Levi's denim jacket"
  brand, type, size,
  grade: "A" | "B" | "C" | "D" | null,
  condition_notes: [string],        // e.g. "small mark on left sleeve"
  special: string | null,           // e.g. "limited edition 2019 run"
  claim: string | null,             // seller's own claim, e.g. "signed by Kobe Bryant", "hand-painted back"
  claim_proof: url | null,          // close-up photo of the signature or modification
  seller_ask: pence | null,         // price the seller asked for, if any
  price_source: "comps" | "seller" | "table",
  price_confidence: "high" | "medium" | "low",
  seller_story: string | null,      // what the seller said about THIS item while filming, cleaned up
  photo_requests: [string],         // retakes the agent wants from the runner, e.g. "Close-up of the signature, it's blurry"
  proof_request: string | null,     // what the agent asked the seller for, e.g. "Any photo of it being signed, or a certificate?"
  seller_proof: [url],              // photos or documents the seller sent back
  photos: [url],
  comps: [{ source, title, price, url }],
  list_price, floor_price,          // pence
  shopify_url | null,
  status: "estimated" | "needs_photos" | "photographed" | "listed" | "offer" | "sold" | "posted"
}

Job {
  id, type: "pickup" | "post",
  pickup_id, item_ids: [id],
  runner_name | null,
  address, pay,                     // pence
  status: "open" | "accepted" | "done"
}

Offer {
  id, item_id, buyer,               // e.g. "Grok Bot"
  amount, counter | null,           // pence
  round: 1 | 2,
  status: "pending" | "accepted" | "countered" | "rejected",
  discount_code | null              // Shopify code for the agreed price
}

Ledger {
  id, item_id, sale_price, seller_amount, runner_amount, our_amount   // pence
}

Event {
  id, ts, actor: "agent" | "seller" | "runner" | "buyer",
  text,                             // plain human sentence for the live feed
  money | null                      // pence, shown big when present
}

### Routes (base: API_BASE)

POST /api/live/frame        { frame_b64, transcript }            -> { prompt, notes }
POST /api/pickups           { seller_name, address, frames_b64: [..], transcript } -> Pickup
    (optional audio_b64: the voice recorded while filming, data URL; the server transcribes it with OpenAI when the browser could not caption)
POST /api/pickups/:id/book  {}                                    -> Job
POST /api/jobs/:id/accept   { runner_name }                       -> Job
POST /api/items/:id/photos  { photos_b64: [..] }                  -> Item   (graded + priced)
POST /api/items/:id/ask     { seller_ask }                        -> Item   (seller sets or changes their price)
POST /api/items/:id/proof   { photos_b64: [..], note }            -> Item   (seller answers a proof request)
POST /api/pickups/:id/handover {}                                 -> Pickup (all items listed on Shopify)
POST /api/offers            { item_id, amount, buyer }            -> Offer
POST /api/jobs/:id/done     {}                                    -> Job
GET  /api/state                                                    -> { pickups, items, jobs, offers, ledger, events }
POST /api/demo/:step        step = estimate | photos | sale | reset -> { ok: true }

The UI polls GET /api/state every 1.5 seconds. No websockets.

### Money split per sale
seller 70% of sale price, runner flat 600p per item (pickup + posting), we keep the rest.

## Stack lock
- Node + Express, plain JavaScript.
- Supabase: Postgres tables matching the shapes above, plus a public Storage bucket `photos`. Service key server-side only.
- Exposed to phones through ngrok (the UI is on Vercel and calls API_BASE). Enable CORS for all origins.
- No auth, no websockets, no Docker, no extra routes.

## Services
- Live filming prompts: OpenAI, the fastest small model with image input on the account (a "mini" or "nano" tier), key OPENAI_API_KEY. Gemini Flash is the fallback if OpenAI errors. Frames arrive already shrunk to about 512px JPEG. Keep the prompt tiny and ask for a one-line JSON answer so replies stay under about 1.5 seconds.
- Pile estimate, grading and descriptions: Claude Sonnet (Anthropic key).
- Price comparisons: Tavily search, public results only (eBay, Depop, ASOS Marketplace, Vestiaire). Never log in or scrape behind a login.
- Shopping: Shopify development store, Admin API. Create products, create one-off discount codes, poll orders every 5 seconds (no webhooks).
- Keys live in .env: OPENAI_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY, TAVILY_API_KEY, SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY.

## Route behaviour
POST /api/live/frame
  The fast model sees one frame plus the last words spoken. Return ONE short prompt from this fixed list only:
  "Show me the label", "Turn it round", "Any marks or damage?", "Show the size tag", "Anything special about it?", "What would you want for this one?", "Show me the signature or the change up close", "Hold it up flat", "Got it, next item", "Looks good, you can stop".
  Plus notes: one short line of what it saw. Timeout 2.5s; on timeout return the previous prompt.
  Example response: { "prompt": "Show me the label", "notes": "grey hoodie, no brand visible yet" }

POST /api/pickups
  Claude reads the frames and transcript. Returns the Pickup with a preview line per item and a pile range.
  Price each preview item with the pricing rule below (comps if cached, table otherwise). Also creates the Items with status "estimated".
  Log Event: "Spotted 6 items. Expect £85 to £120." with money = estimate_high.

POST /api/pickups/:id/book
  Pickup -> "booked". Creates an open pickup Job with pay = 600 x number of items. Event: "Runner booked for pickup."

POST /api/jobs/:id/accept, POST /api/jobs/:id/done
  Straight status changes plus a plain Event each.

POST /api/pickups (extra)
  Claude splits the transcript by item and fills seller_story for each: what the seller said about it, cleaned up but in their words. If an item has a claim, set proof_request, e.g. "You said it's signed by Kobe Bryant. Do you have a photo of it being signed, a receipt or a certificate?" Event: "Asked the seller for proof of the signature."

POST /api/items/:id/photos
  Upload to Storage. First, Claude checks the photos are good enough: front, back, label, every mark in condition_notes, and the claim close-up if there's a claim. Anything missing or blurry goes into photo_requests as a plain instruction ("The signature is blurry, get a close-up in good light") and status becomes "needs_photos". Event: "Asked the runner for a clearer shot of the signature." When nothing is missing, clear photo_requests and continue. Claude grades A to D from the photos plus anything the seller said about that item (marks, special edition). Fill condition_notes and special. Run pricing. Status "photographed".

POST /api/pickups/:id/handover
  Every photographed item is created as a Shopify product (title, description in plain human voice, photos, list price). The description is built from seller_story first, so it carries the seller's own details and history, then condition notes stated honestly. If seller_proof exists, say so: "Seller has shared a photo from the signing." Items still in "needs_photos" are skipped until fixed. Put this line at the end of each description:
  "Want it cheaper? Make an offer: <UI_BASE>/offer/<item_id>"
  Pickup -> "listed". Event per item: "Listed Levi's jacket at £38."

POST /api/offers
  If amount >= floor: accept, create a Shopify discount code for exactly (list - amount), return it.
  Else round 1: counter at the midpoint of amount and list, but never below floor.
  Round 2 below floor: reject politely. Event for every step, e.g. "Grok Bot offered £28. Countered at £33."

Order polling
  When an order arrives for an item: status "sold", write Ledger (seller 70%, runner 600p, we keep the rest), create a post Job, Event with money = sale price: "Sold. Seller gets £26.60."

## Pricing rule
Many items here are rare, vintage, customised or have no logo, so web matches will often fail. Handle that honestly.
1. Listen for claims and asks. If the seller says something like "signed by Kobe Bryant", "I customised this" or "I want £80 for it", store it in claim and seller_ask. Live prompts should ask "What would you want for this one?" when the model sees something unusual (no label, hand-made changes, writing, patches).
2. Search. Tavily with brand + type + size. If there's no brand, search by description instead: era, style, material, features (e.g. "90s embroidered denim jacket patches"). Take the middle of 3 to 5 matches. price_source "comps", confidence "high" for 4+ close matches, "medium" for 2 to 3.
3. Adjust by grade: A x1.0, B x0.85, C x0.65, D x0.4. Special edition noted: x1.2.
4. Seller ask wins. If seller_ask is set, list at seller_ask, price_source "seller", floor = 80% of the ask. If comps say it's worth much less, add an Event: "Similar ones sell around £30. Listed at your £80 anyway, I'll tell you if it's slow." Never overrule the seller.
5. Nothing found and no ask: base table by type (jacket 3000, jeans 2000, hoodie 2000, t-shirt 800, dress 2200, trainers 3500, other 1200) x brand tier (designer 3, premium 1.8, high street 1, unknown 0.7), then the grade multiplier. price_source "table", confidence "low", and add an Event asking the seller to set a price: "Couldn't find anything like this online. What would you want for it?"
6. Floor otherwise = 70% of list_price.
7. Claims are never stated as fact. The listing says "Seller says it's signed by Kobe Bryant. Close-up of the signature included." and only if claim_proof exists; without proof the claim stays off the listing and the seller is told why. We don't authenticate in v1.

POST /api/items/:id/proof: store the files in seller_proof, clear proof_request, Event: "Seller sent proof for the signed jacket." We show proof to buyers, we don't judge it.

POST /api/items/:id/ask: set seller_ask, rerun rule 4, update the Shopify price if already listed.

## Build order (time caps)
1. 11:45 to 12:05: seed. Supabase tables, /mock/seed.json matching the contract with 6 realistic Fleek-style items (share this file with the UI), GET /api/state working.
2. 12:05 to 12:45: /api/pickups with Claude, then /api/live/frame with Gemini.
3. 12:45 to 13:15: photos, grading, pricing with Tavily and the fallback table.
4. 13:15 to 13:50: Shopify listing, offers with discount codes, order polling.
5. 13:50 to 14:15: demo cache and demo steps.
6. 14:30: FEATURE FREEZE. Bugs only after this.

## Model rules
- At boot, load /cache/demo.json: the estimate, grades, comps and prices for the Fleek demo items. The scripted demo path uses the cache first and never waits on a model.
- Every runtime model call has a short timeout and a plain fallback. Never call a model inside GET /api/state.
- POST /api/demo/estimate, /photos and /sale push the cached next step (the hidden keys in the UI use these). /reset wipes state back to seed.

## Voice
Every Event and description reads like a friendly person, short and specific. Never "As an AI". No emoji spam.
Empty states are honest: "No price matches found, priced from our table." is a feature, not an error.

## Do not
Add routes, rename contract fields, touch the frontend, add login.
