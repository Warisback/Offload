# offload backend

Film your pile, the agent sells it. Node + Express (plain JS), Supabase, OpenAI (or Claude Sonnet), Gemini Flash as backup, Tavily, Shopify.
Spec and contract: `CLAUDE.md`. Internal design and frontend agreements: `DESIGN.md`.

## Run it (5 minutes)

```sh
cd server
npm install
cp .env.example .env          # fill in the keys you have; every missing key falls back, nothing crashes
npm start                     # http://localhost:8787
ngrok http 8787               # phones reach it through the https URL ngrok prints
```

1. **Supabase**: paste `schema.sql` into the SQL editor and run it once (tables + public `photos` bucket).
   Without Supabase the server keeps state in memory and photos inline, so the demo still works.
2. **Shopify** (development store): create an app with Admin API scopes `write_products, read_products, write_discounts,
   read_orders, write_draft_orders, read_publications, write_publications`, put the store and token in `.env`.
   Set the store currency to **GBP**. Test orders: Settings > Payments > Bogus Gateway, or use the demo sale (it places a real
   paid draft order that the 5-second order poller picks up).
   If the app was made in the Partner/Dev Dashboard, also request **protected customer data** access (Orders) in the app's
   API access settings, or the order poller gets "access denied" every tick. The demo sale still completes on its own
   after 12 s, but a real Grok Bot checkout would never be seen. Check the boot log for `shopify` warnings.
3. **UI**: point the Vercel UI at the ngrok URL (`VITE_API_BASE`, or open the site once with `?api=https://xxxx.ngrok-free.app`)
   and set `UI_BASE` here to the Vercel URL so every Shopify listing links to `/offer/<item_id>`.

Boot prints which services are on, e.g. `brain openai gpt-5.4-mini | live prompts openai on | gemini on | tavily on | shopify on | supabase on`.
The brain (estimate, grading, comps filter, descriptions) runs on Claude Sonnet when `ANTHROPIC_API_KEY` is set, otherwise on OpenAI.

## Check it

```sh
node scripts/smoke.js http://localhost:8787    # walks every route + the demo steps (resets state first!)
node scripts/validate.js                        # seed matches the contract and the pricing rule
node scripts/validate.js http://localhost:8787  # the live state does too
node scripts/validate.js --cache                # the demo cache, with the prices it will produce
```

## The demo keys (on /live)

| Key | Route | What happens |
|---|---|---|
| E | `POST /api/demo/estimate` | Maya's pile appears: "Spotted 6 items. Expect £X to £Y.", proof request for the signed jersey |
| P | `POST /api/demo/photos` | Runner collects and photographs everything; the jersey's signature is blurry, so the agent asks for a retake |
| P again | | The retake lands, the jersey is graded |
| S | `POST /api/demo/sale` | Lists anything unlisted on Shopify, Grok Bot offers below the floor, agent counters, Grok Bot accepts with a real discount code, the order lands, money splits 70% / £6 / rest, post job booked |
| 0 | `POST /api/demo/reset` | Back to `mock/seed.json` (memory and Supabase) |

Each step fast-forwards anything that hasn't happened yet, so S works even if you never pressed E or P.
The demo path reads `cache/demo.json` and never waits on a model.

**Use your real photos:** put them in `cache/photos/<item key>/` and run `node scripts/upload-demo-photos.js`
(instructions at the top of that file). Edit `cache/demo.json` so the items match the pile you will film.

## When a service is down

| Missing or failing | What happens |
|---|---|
| OpenAI live prompts | Gemini answers instead if there's time left in the 2.5 s budget, otherwise the previous prompt is returned |
| Brain: estimate | the estimate uses the demo cache pile |
| Voice transcription | the estimate uses the frames and whatever the browser captioned |
| Brain: photos | graded from the demo cache for demo items, otherwise B with an honest feed line; the last photo of an upload stands in as the claim close-up |
| Brain: descriptions | a plain template built from the seller's story and the condition notes |
| Tavily | priced from the table (rule 5) and the seller is asked for their price |
| Shopify | items still list in offload (no `shopify_url`), retried every 30 s; offers accept without a code and say so |
| Supabase | memory only; photos kept as small inline images |

## Money

Seller 70% of the sale, runner a flat 600p per item (the pickup job shows 600 x items, each post job shows £6 of that same
money), offload keeps the rest. All money is integer pence.

## Frontend notes

- Free ngrok shows an HTML warning page to browsers unless each request sends `ngrok-skip-browser-warning: 1`. The UI's API
  client sends it.
- Events come back oldest first. Runner photos go in one upload per item, claim close-up last.
