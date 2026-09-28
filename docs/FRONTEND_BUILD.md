# offload frontend build brief (shared by every page agent)

Hackathon today (Grok Bot Commerce London at Fleek, 26 Sept 2026). Feature freeze 14:30, live demo 17:30. The product is **offload**
(older docs say "Stash": never show that name). React 19 + TypeScript + Vite 6 + Tailwind v4 + Motion 12 (`motion/react`) + Lucide + React Router 7 + qrcode.react.
Screens and states: `docs/original-brief.md` (the "Screens and states" section is the spec). Backend contract: `src/types.ts` (exact). The backend lives in `server/` (read-only for you).

## Foundation (already written, import it, do not rewrite it)

- `src/types.ts`: every contract type, `LIVE_PROMPTS`, `RUNNER_FEE`, `SELLER_SHARE`.
- `src/lib/api.ts`: `api.state / liveFrame / createPickup / book / acceptJob / uploadPhotos / setAsk / sendProof / handover / makeOffer / jobDone / demo`, `ApiError`, `errorMessage`. Real or mock is decided in `src/lib/config.ts`; pages never care which.
- `src/lib/state.tsx`: `useAppState()` gives `{ state, error, online, lastUpdated, refresh, upsert }` (polled every 1.5 s app-wide; `state` is null until the first poll). `useMutation(fn)` gives `{ run, pending, error, clearError }`, blocks double submits and refreshes after. After a mutation that returns a row, call `upsert(kind, row)` so the UI updates instantly.
- `src/lib/selectors.ts`: `latestPickup, pickupById, itemById, itemsOf, offersFor, latestOffer, ledgerFor, pickupJob, postJobs, ledgerOfPickup, sellerEarned, soldTotal, runnerEarned, eventsNewestFirst, isOnSale, isSold, compsMedian, PRICE_SOURCE_LABEL, STATUS_LABEL, GRADE_LABEL` and per-device memory `myPickupId/setMyPickupId, myRunnerName/setMyRunnerName, mySellerName/setMySellerName, myAddress/setMyAddress`.
- `src/lib/money.ts`: `formatMoney(pence)` ("£38", "£26.60"), `formatRange`, `parsePounds(str) -> pence|null` (no floats), `toPoundsInput`, `splitSale`.
- `src/lib/images.ts`: `fileToDataUrl(file, maxEdge=1600, q=.82)` (always shrink phone photos before upload), `videoFrame(video, maxEdge=720)`, `sampleEvenly`.
- `src/lib/keys.ts`: `demoKeyAction(event)` for the hidden /live keys (already guards inputs and modifiers).
- `src/lib/config.ts`: `USE_MOCK`, `API_BASE`, `PUBLIC_URL`, `runnerLink()` (QR target, carries the `?api=` override), `isLocalOrigin(url)`.
- `src/components/ui.tsx`: `Header`, `Footer`, `Logo`, `PageShell` (kicker/title/subtitle/action + sync banner), `Button` (variants dark/light/outline/accent, `pending`), `ButtonLink`, `Chip` (tones plain/green/accent/peach/warn), `ConnectionBadge`, `Loading`, `EmptyState`, `ErrorNote`, `useTitle`, `useIsPhone()` (< 768px).
- `src/components/motion.tsx`: `EASE`, `SPRING`, `SOFT_SPRING`, `Reveal`, `Stagger` + `rise`/`pop` variants, `CountUp` (animated money), `PageTransition` (already wraps every route), `press`.
- Styles: `src/style.css` is the original design (tokens in `:root`, classes like `.button .chip .panel .stats .tab-row .workspace .product .capture-layout .job-card .event .money-banner ...`). `src/styles/app.css` adds tokens (`--accent-ink --success --warn --danger --shadow-lg --radius-lg --tap --ease --safe-*`) and shared component styles.
- The original design preview markup is in `docs/preview-main.tsx.txt` and the readable original CSS in `docs/preview-style.pretty.css`. Start from that markup and class vocabulary so the look is preserved.

## Ownership (parallel agents: touch ONLY your files)

| Agent | Files |
|---|---|
| landing | `src/pages/Landing.tsx`, `src/pages/landing.css`, `public/images/*`, `public/manifest.webmanifest`, `index.html` |
| seller | `src/pages/Seller.tsx`, `src/pages/seller/*`, `src/pages/seller.css`, `src/lib/media.ts` |
| runner | `src/pages/Runner.tsx`, `src/pages/runner/*`, `src/pages/runner.css` |
| live | `src/pages/Live.tsx`, `src/pages/live/*`, `src/pages/live.css` |
| offer | `src/pages/Offer.tsx`, `src/pages/offer.css` |
| mock | `src/lib/mock.ts`, `tests/*`, `public/mock/*`, `package.json` (scripts only) |

Everything else (foundation files, `style.css`, `app.css`, `main.tsx`) is shared: do not edit it. If you truly need a foundation change,
write the smallest possible note in your final report instead. Import your CSS file at the top of your page (`import './seller.css'`).
Prefix your CSS classes with your page (`.sl-`, `.rn-`, `.lv-`, `.of-`, `.ld-`) so pages never collide; reuse the shared classes freely.

## Design direction (keep the identity, make it better)

White/off-white, near-black ink, periwinkle `#7888ef` (`--accent`), pale lavender/mint/peach panels, DM Sans, big tight headlines
(letter-spacing about -0.05em), pill buttons, generous whitespace, rounded image corners, editorial photography, floating cards.
Improve polish: clear hierarchy, consistent spacing (8px grid), strong empty/loading/error states, real content from state.
Phone layout (< 768px) is what sellers and runners use for real; judges will scan a QR and act as runners on their own phones, so the
runner phone view must work first time with no instructions. Desktop (>= 768px) goes on a projector: big numbers, high contrast.
Test mentally at 375px, 390px, 768px, 1440px: no horizontal scroll, touch targets >= 44px, readable labels, keyboard reachable.

## Motion (the user asked for more animation and motion; make it purposeful)

Use `motion/react`. Entrances: stagger lists (`Stagger` + `rise`), `Reveal` on scroll for sections. State changes animate:
`AnimatePresence` + `layout` for lists that grow (feed events, job cards, thumbnails), `CountUp` for every money number that changes,
springs (`SPRING`) for presses and pops, shared `layoutId` for small morphs (tabs indicator, selected card). Celebrate the money moments
(sale landed, graded, accepted offer) with a short, tasteful beat (scale pop, glow, check draw), never confetti spam. 60fps: animate
transform/opacity only. Reduced motion is handled globally by `MotionConfig reducedMotion="user"`; do not add motion that carries meaning
without a static equivalent.

## Contract decisions (agreed with the backend)

- Money is integer pence everywhere; parse inputs with `parsePounds`. Show `£` with pence only when not whole (`formatMoney`).
- Events come oldest-first; use `eventsNewestFirst` for feeds.
- Runner pay: pickup job `pay` = 600 x items ("£36 for this pickup"); post job `pay` = 600 ("Post the Levi's jacket, £6") but that £6 is
  already inside the pickup pay. Runner earnings = `runnerEarned()` (done pickup jobs only). Never add post pay or ledger on top.
- Post jobs arrive with `runner_name` = the runner who collected and `status: "accepted"`; the runner just taps "Posted" (`jobDone`).
- The runner app uploads each item's photos in one `uploadPhotos` call ordered front, back, label, marks..., **claim close-up last**.
  The backend turns the close-up into `claim_proof`. If the returned item has `status: "needs_photos"`, show `photo_requests` and block
  "Next item" and handover until a retake upload returns `photographed`.
- Handover lists every `photographed` item; `needs_photos` items are skipped by the backend until fixed.
- Offers: two rounds. Round 1 below floor -> `countered` with `counter`; accepting = posting `counter` as the new amount. Round 2 below
  floor -> `rejected`. `accepted` returns `discount_code` (may be null if Shopify is down; say so honestly).
  Checkout link: only when `shopify_url` exists, as `https://<shopify host>/discount/<CODE>?redirect=/products/<handle>` (handle = last
  path segment of `shopify_url`). Never fabricate a checkout URL.
- The ledger has no payout status: say "earned", not "paid out". Platform share can be negative on very cheap sales; show the backend
  number as-is, never invent one.
- Price source labels: comps "web matches", seller "seller's price", table "our table" (`PRICE_SOURCE_LABEL`).
- Copy: plain, friendly, short, like a person talking. Never "As an AI" or "processing". No emoji spam. Honest empty states
  ("No price matches found, priced from our table." is a feature).
- Realistic content to design against: `server/mock/seed.json` (the reset state) and `server/cache/demo.json` (the live demo pile).

## Verification (each agent)

Run `node_modules/.bin/tsc --noEmit -p tsconfig.json` and fix every error in YOUR files (ignore errors in files other agents are still
writing). Do NOT run `vite build` or a dev server (parallel agents would collide on `dist/`); the integration step builds once at the end.
Keep components small; no new npm dependencies.
