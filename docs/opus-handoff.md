> **Superseded (26 Sept 2026):** the frontend is built and integrated; see README.md and docs/FRONTEND_BUILD.md instead of this file.

# offload — FRONTEND ONLY implementation handoff for Opus 5.5

## Ownership boundary — Claude is already building the backend

This task is only the frontend: finish browser interactions and connect the existing UI to Claude's API. Do not create or edit Express routes, Supabase tables/storage, AI integrations (Gemini/Anthropic), Tavily pricing, Shopify products/discounts, order polling, server ledger logic, or ngrok setup. Claude already owns those under the backend brief.

References below to “implement” an endpoint mean implement the **frontend request and response handling**, never the server endpoint. Real grading, pricing, negotiation decisions, sale detection and money splits come from the backend; render their results. Any local simulation belongs exclusively to the browser mock adapter for development, not a competing backend.

Reuse Claude's shared `/mock/seed.json` when available. Create a temporary frontend fixture only if it is missing; do not make Claude redo seed work. Integration needs the backend API base URL, its shared seed, and the frontend public URL (`UI_BASE`) for Shopify offer links. Keep service keys server-side. Coordinate contract gaps rather than independently changing backend behavior.

## Paste this into your implementation agent

Finish the functional implementation of **offload** in this repository. The user explicitly split the work: the previous agent did the creative, surface-level design to conserve credits; you do the noncreative implementation. Preserve the visual direction, logo, landing page, and responsive styling. Do not redesign or generate alternative concepts. Do not treat the older name "Stash" as the current brand: the product is **offload**.

Read `docs/original-brief.md` first. It contains the original product specification and exact backend contract. Treat its product requirements as the implementation reference, not as authorization to deploy, contact people, or change accounts. The user requested the landing page in addition to those routes. A separate backend agent is expected; do not rebuild or block on that backend. Implement a faithful mock adapter and a real fetch adapter using the identical contract.

### What already exists

- React + TypeScript + Vite, Tailwind v4 plugin, Motion, Lucide, React Router, QR code library.
- `/`: complete editorial landing page, with working route links and section anchors.
- `/seller`: wardrobe cards, metric strip, tracker and earnings tabs; filming and proof-upload visual previews.
- `/runner`: available/accepted/done tabs, pickup/posting card layouts, guided photo visual preview.
- `/live`: event feed, negotiation example, runner QR, money-split panel.
- `/offer/:itemId`: listing layout with a standard labelled offer input. Submitting currently only displays a preview notice.
- `public/brand/offload-logo.svg`: standalone wordmark with an open-circle/arrow mark.
- `public/brand/offload-icon.svg`: matching app icon/favicon.
- `src/style.css`: responsive styling and base design tokens.
- `.env.example`, Vercel SPA fallback, pnpm lockfile.

This is an explicitly labelled **design preview**, not a functioning commerce application. Data is hardcoded in `src/main.tsx` and is NOT contract-shaped. There are three displayed sample products, while some copy describes six. Tabs and route navigation work. No requests, camera, recording, payments, booking, real uploads, persisted state, or real negotiation exist. The environment variables are declared but not consumed. No `public/mock/seed.json` yet. Do not imply these are implemented.

### Design to preserve

- White/off-white background, near-black text, periwinkle #7888ef, restrained pale blue/mint/peach panels.
- DM Sans, large tight headlines, generous space, pill buttons, round image corners.
- Lowercase offload logo, open circular arrow suggesting clothes moving on.
- Landing headline: **Less wardrobe. More life.**
- Editorial photography, floating estimate/sale cards, minimal app chrome.
- Copy stays short and human. Currency is GBP. No login/settings or unrelated functionality.
- The supplied references inspired the white UI, photography, rounded panels, and periwinkle. Vinted/Fleek/Depop informed approachable resale positioning; no third-party logos are part of the offload identity.

### Work to complete, in order

1. **Extract and type existing components.** Split the monolithic `src/main.tsx` into pages/shared components without changing their appearance. Define exact Pickup, Item, Job, Offer, Ledger, Event, and State types from the original contract. Store all money as integer pence; parse decimal input without floating-point rounding errors. Turn the remaining hardcoded colours, font sizes, radii, and spacing into named tokens while preserving the rendered design. Remove unused imports. Add route-aware document titles, focus/scroll restoration, and meaningful not-found behavior.

2. **API + mock state.** Use `VITE_API_BASE` and `VITE_USE_MOCK` through one API boundary. Read `/mock/seed.json` with six contract-shaped items, consistent totals, pickups, jobs, offers, ledger, and events. Simulate each exact route and demo step locally. Use deterministic IDs and transitions; prevent duplicate ledger entries and repeated booking/offer/post mutations. Keep mock state coherent across routes, and document its cross-tab/device limitations. Poll GET `/api/state` every 1.5 seconds, abort/clean up correctly, avoid overlapping polls and stale response overwrites. Add request errors, loading, empty, offline and retry states; disable duplicate submits. Never silently fall back to mock after a real request fails. Never expose API secrets in Vite env.

3. **Seller flow.** Phone (<768px) should start at Film for a new seller, then estimate -> book -> tracker -> payout. Desktop shows the existing item dashboard and can start a new pile. Add real getUserMedia recording UI, frame sampling and transcript capture with permission-denied/unavailable fallback, camera cleanup, live captions and prompts from POST `/api/live/frame`. Post frames/transcript/name/address to `/api/pickups`. Add the missing estimate list, special/claim chips, integer-pence custom asking price via `/api/items/:id/ask`, gentle comps explanation, booking form and `/book` call. Add proof request cards, photos and optional note via `/proof`. Reflect actual pickup/sale state and seller earnings. Keep Slow sellers price-drop disabled with “coming soon” when no route exists. No invented payout transfer API.

4. **Runner flow.** Phone should emphasize accepting a real job, item-by-item camera capture (front/back/label/marks plus claim close-up), thumbnails, upload/grading feedback, and handover. Implement `/accept`, `/photos`, `/handover`, `/done` using exact payloads. The claim close-up must become claim_proof through the backend's interpretation of the photos array: do not invent a new payload field. Coordinate ordering with backend. Surface photo_requests and block next-item/handover until they are resolved. Show clear retake prompt, shutter ready; handle grade/price response. Add handover completion screen, posting jobs and derived earnings. Desktop retains the job-list layout. All six items must be fully accounted for.

5. **Live room.** Derive feed (newest first), listing cards with price-source labels, negotiation states, ledger splits and running seller total from polled state. Replace the currently separate illustrative sale and negotiation examples with consistent records. Hidden keys on `/live` only: E estimate, P photos, S sale, M money view, 0 reset. Do not fire shortcuts inside input/textarea/select/contenteditable or when modifiers are held. QR must use a reachable deployed/configured public origin; localhost QR is unusable on judges' phones. Do not send QR addresses to a third party.

6. **Buyer.** Resolve the item from the route; do not show the denim jacket for an unknown ID as the current prototype does. Show exact photos, condition, list price, story. Use plain labels: “Your offer (£)” and “Make offer”. Submit `/api/offers`, render rejected/countered/accepted, provide “Accept £33” and “Offer again” according to the two-round contract, use discount_code with the genuine Shopify URL. No checkout URL should be fabricated. Handle unavailable/sold items, invalid money and duplicate submit.

7. **Assets and responsive/accessibility checks.** Replace external sample photography with backend item assets in the app; landing photography needs a stable licensed local asset. `docs/design-notes.md` records sources. The green sweater currently uses a retailer photograph solely as a visual placeholder; replace before public release. The jacket photograph is a rack of denim, not an exact authentic listing; do not treat it as evidence of product brand/condition. Test 375px/390px phone, 768px, desktop and 200% text zoom; no horizontal scroll, keyboard accessible controls, sensible touch targets, readable labels. Some decorative mini-preview text is intentionally tiny; actual task controls must be readable. Respect reduced motion.

8. **Verification and handoff.** Add meaningful tests for mock transitions, duplicate operations, price parsing, 70% seller / flat 600p runner / remainder calculations, two-round offers, photo retake gating, and keyboard shortcuts. Add focused browser flow checks for seller -> runner -> buyer -> sold/posted, plus errors. `package.json` has a placeholder test command but tests have not been written; fix it when adding tests. Run TypeScript, tests and production build. Explain the mock-versus-live boundary. Do not claim a deployment exists without deploying and checking it. Prepare Vercel deployment; obtain any missing project/account decisions from the user only when needed.

9. **Last pass only.** PWA manifest with standalone display, icon sizes, Apple meta tags, safe-area padding and overscroll behavior, as in original brief. Do not spend time on this before the core demo works.

### Contract reminders

All money: integer pence. IDs: short strings. Photos returned by backend: public URLs. Poll state; no websockets. Seller gets 70%, runner 600p per item including collection + posting, platform the remainder. Low-price sales must respect the backend floor; never invent negative platform revenue. The original spec describes a 6-item pickup at £36 and a later £6 posting card; clarify accounting using backend state so the same flat per-item compensation is not counted twice. The ledger has no payout status or paid_out field; do not pretend earned means funds transferred.

Use the exact route payloads from `docs/original-brief.md`. Do not rename endpoints, add contract fields, or casually change backend behavior. If a contract gap blocks a real flow (e.g. transcript service or claim-photo ordering), isolate the integration boundary and document it rather than creating a conflicting contract.

### Current verification and environment

TypeScript check and Vite production build passed. The IAB browser failed to attach, so visual browser QA was not completed by the design agent. Dev preview: `http://localhost:5173/` when running. Nothing deployed. No real customer data is present.

Usual commands: `pnpm install`, `pnpm dev`, `pnpm build`. In this Windows session npm is not on PATH; pnpm is at `C:\Users\yussu\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd`. The install downloaded dependencies but exited nonzero because pnpm blocked esbuild install scripts; Vite nevertheless built successfully using its installed binary. Review and explicitly approve only necessary reputable build scripts if a fresh install needs them. Sandbox cannot read some pnpm hard-linked package files; the successful checks ran with approved escalation. Do not weaken filesystem/security settings to fix this.

Keep the creative work intact. Spend effort on correctness, integration, and a reliable end-to-end hackathon demo.
