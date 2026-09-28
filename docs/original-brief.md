# ASTRA.md: Stash UI (working name)

## Context
One-day hackathon: Grok Bot Commerce London at Fleek HQ, Saturday 26 Sept 2026. Solo builder.
Feature freeze 14:30, live demo 17:30. A separate agent (Claude Code) builds the backend to the exact contract below. You build only the UI. Never wait on the backend: use mock mode.

## Freedom line
Structure, screens, flows, states and interactions are locked by this brief. The look is yours to shape from the reference images I give you. Put every colour, font, radius and spacing value in CSS variables or the Tailwind config so I can swap the style fast.

## The product
People bin clothes because selling them is a chore. With Stash you film your pile and talk about it, get told what to expect, and a vetted local runner collects it and photographs everything. The agent then prices, lists, haggles with buyers (including AI shopping bots) and books the runner to post each sale. The seller does nothing after the video.
Judges: Fleek, Wassist, Huge, Episode 1 Ventures, Entrepreneurs First. They reward a clear commerce problem, great buyer and seller experience, and a working prototype.

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

## Stack
React + Vite + Tailwind + Motion. One app, deployed to Vercel. Routes: /seller, /runner, /live, /offer/:itemId.
Fetch wrapper with API_BASE and USE_MOCK. In mock mode read /mock/seed.json (same shapes as the contract) and fake the steps locally.
Poll GET /api/state every 1.5s. No websockets.

## Two layouts for every role (this matters)
- PHONE layout (under 768px): what the seller and the runner use in real life. The judges will scan a QR code and act as runners on their own phones, so the runner phone view must work first time with no instructions.
- DESKTOP layout (768px and up): what the seller and runner would see on a laptop, and what goes on the projector. Must read clearly from the back of a room: big numbers, high contrast.
Switch layouts by screen width, not by a toggle.

## Screens and states

### /seller (phone)
1. Film: full-screen camera with a record button. While recording, a big prompt bubble floats over the video and updates every few seconds from POST /api/live/frame (e.g. "Show me the label"). Show a small live caption of what the seller is saying. States: ready, recording, thinking (after stop).
2. Estimate: headline "Expect £85 to £120", then one row per spotted item with its range. Rows where price_confidence is "low" or the item has a claim show a chip ("One of a kind" or "Signed, you said") and a "Set your price" input that calls POST /api/items/:id/ask. If comps are lower than their ask, show it gently under the row: "Similar ones sell around £30." One button: "Book a pickup". States: loading, ready, error ("Couldn't read that video, try again in better light").
3. Tracker: any open proof_request shows at the top as a card: the agent's question, an "Add photos" button and an optional note, calling POST /api/items/:id/proof. Then a simple timeline of the pickup: Booked, Runner on the way, Collected, Listed, then each sale. Each sale row shows what the seller gets.
4. Payout: total earned so far, big.

### /seller (desktop)
Items grid: photo, name, grade, price, status chip, and the seller's story snippet under each item. Top strip: estimate vs sold so far vs paid out. A "Slow sellers" card with a one-tap "Drop price 15%" per item (UI only is fine if the backend has no route; show it disabled with "coming soon" rather than faking it).

### /runner (phone)
1. Job card: address, number of items, pay ("£36 for this pickup"), "Verified runner" badge, button "Accept".
2. Guided photos: one item at a time using the item names from the estimate. Step prompts: front, back, label, any marks. If the item has a claim, add one more step: "Close-up of the signature or the change". That photo becomes claim_proof. After upload, if the item comes back with photo_requests, show them as a clear card ("The signature is blurry, get a close-up in good light") with the shutter ready, and don't let the runner move on until it's fixed. This is a demo moment, so make it obvious and friendly. Big shutter button, thumbnails below, "Next item". Uploads via POST /api/items/:id/photos. Show the grade appearing after upload ("Graded B, listing at £38").
3. Handover: "All 6 items photographed" and button "Confirm handover" (POST /api/pickups/:id/handover).
4. Posting jobs: when an item sells, a new card appears: "Post the Levi's jacket, £6". Button "Posted" (POST /api/jobs/:id/done).
Earnings today shown at the top throughout.

### /runner (desktop)
Job list (open, accepted, done), earnings today and this week, next job highlighted.

### /live (desktop, the projector)
Left: the agent feed. Events from /api/state, newest on top, each a plain sentence with actor icon. Money events show the amount large.
Right: current listing cards (each with a small "priced from: web matches / seller's price / our table" line) and the live negotiation (offer, counter, accepted) for any item with an open Offer.
Bottom or final state: the money screen. "Sold £38. Seller £26.60. Runner £6. Stash £5.40." plus the seller's running total. This is the last thing judges see.
Also show a QR code linking to /runner so judges can scan it.

### /offer/:itemId (buyer page, phone and desktop)
Item photo, name, list price, one input "Your offer (£)", button "Make offer". Shows the reply: accepted with the discount code and a "Go to checkout" link, or the counter with "Accept £33" and "Offer again". The Grok Bot shopping agent will use this page in a browser, so keep labels plain and inputs standard HTML with clear labels.

## Copy rules
Plain, friendly, short, like a person talking. Never "As an AI", never "I'm processing". Money always shown as £ with pence when not whole.

## Hidden demo keys (on /live only, invisible to judges)
E: POST /api/demo/estimate. P: POST /api/demo/photos. S: POST /api/demo/sale. M: jump to the money screen. 0: POST /api/demo/reset.

## Last 20 minutes only
PWA pass: manifest standalone, apple meta tags, safe-area padding, no overscroll bounce.

## Do not
Invent screens, change contract shapes or routes, block on the backend, add login or settings.