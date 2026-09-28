// Claude Sonnet calls: pile estimate, photo check, comps filter, listing copy.
// Every call uses structured outputs, so the reply is JSON matching the schema sent with it.
// Adapters throw on failure; callers apply the plain fallback.
import Anthropic from '@anthropic-ai/sdk';
import { config, has } from './config.js';
import { sample } from './images.js';
import { withTimeout, TimeoutError, warn, clip, gbp, toPence } from './util.js';

export const TYPES = ['jacket', 'jeans', 'hoodie', 't-shirt', 'dress', 'trainers', 'other'];
export const TIERS = ['designer', 'premium', 'high street', 'unknown'];
export const GRADES = ['A', 'B', 'C', 'D'];

const MAX_FRAMES = 12;
const MAX_PHOTOS = 10;
const MAX_CANDIDATES = 20;
const MAX_MATCHES = 5;
const MIN_COMP_PRICE = 100; // under £1 is a starting bid or postage, not a sale price
const MAX_IMAGE_B64 = 5 * 1024 * 1024; // well under the API's per-image cap

// Claude when there's an Anthropic key, otherwise the same prompts and schemas go to OpenAI (see callOpenAI).
export const isConfigured = () => has.claude() || has.openai();
export const provider = () => (has.claude() ? `claude ${config.anthropicModel}` : has.openai() ? `openai ${config.openaiBrainModel}` : 'none');

// ---------- client and the one call everything goes through ----------

let client = null;

function requireKey() {
  if (!config.anthropicKey && !config.openaiKey) throw new Error('not configured');
}

function getClient() {
  requireKey();
  client ??= new Anthropic({ apiKey: config.anthropicKey, maxRetries: 0, timeout: config.timeouts.estimate });
  return client;
}

// OpenAI transport for the same calls: same system prompt, same labelled images, same strict JSON schema
// (every object already has additionalProperties:false and all keys required, which strict mode needs).
async function callOpenAI(label, { system, content, schema, maxTokens, timeoutMs }) {
  const ctrl = new AbortController();
  const model = config.openaiBrainModel;
  const parts = content.map((b) =>
    b.type === 'image'
      ? { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}`, detail: 'auto' } }
      : { type: 'text', text: b.text },
  );
  const body = {
    model,
    // reasoning tokens count against this cap, so leave room on top of the answer itself
    max_completion_tokens: maxTokens * 2 + 2000,
    ...(/^gpt-5\.\d/.test(model) ? { reasoning_effort: process.env.BRAIN_EFFORT || 'none' } /* benchmarked: 3.0 s vs 7.6 s at 'low', and truer to the transcript */ : /^gpt-5/.test(model) ? { reasoning_effort: 'minimal' } : {}),
    response_format: { type: 'json_schema', json_schema: { name: label.replace(/\W+/g, '_'), strict: true, schema } },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: parts },
    ],
  };
  try {
    const request = fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openaiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    }).then(async (r) => {
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${oneLine(j?.error?.message)}`);
      return j;
    });
    const res = await withTimeout(request, timeoutMs, `openai ${label}`);
    const choice = res?.choices?.[0];
    if (choice?.message?.refusal) throw new Error('refused');
    if (choice?.finish_reason === 'length') throw new Error('cut off (length)');
    const text = choice?.message?.content;
    if (!text) throw new Error('empty reply');
    let out;
    try {
      out = JSON.parse(text);
    } catch {
      throw new Error('reply was not valid JSON');
    }
    if (!out || typeof out !== 'object' || Array.isArray(out)) throw new Error('reply was not an object');
    return out;
  } catch (e) {
    ctrl.abort();
    const why = e instanceof TimeoutError ? 'timed out' : oneLine(e?.message || String(e));
    warn(`openai ${label} failed: ${why}`);
    throw new Error(`openai ${label}: ${why}`);
  }
}

async function callClaude(label, opts) {
  if (!config.anthropicKey) return callOpenAI(label, opts);
  const { system, content, schema, maxTokens, timeoutMs } = opts;
  const api = getClient();
  const ctrl = new AbortController();
  // Sonnet 5 rejects temperature/top_p/top_k and assistant prefill, so none of them are sent.
  const params = {
    model: config.anthropicModel,
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content }],
  };
  try {
    const request = api.messages.create(params, { timeout: timeoutMs, signal: ctrl.signal });
    return readJson(await withTimeout(request, timeoutMs, `claude ${label}`));
  } catch (e) {
    ctrl.abort(); // nothing outlives its timeout
    return fail(label, describe(e));
  }
}

function fail(label, why) {
  warn(`claude ${label} failed: ${why}`);
  throw new Error(`claude ${label}: ${why}`);
}

function readJson(res) {
  const stop = res?.stop_reason;
  if (stop === 'refusal') throw new Error('refused');
  if (stop === 'max_tokens' || stop === 'model_context_window_exceeded') throw new Error(`cut off (${stop})`);
  const text = res?.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('empty reply');
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    throw new Error('reply was not valid JSON');
  }
  if (!out || typeof out !== 'object' || Array.isArray(out)) throw new Error('reply was not an object');
  return out;
}

const oneLine = (s) => clip(String(s || '').replace(/\s+/g, ' ').trim(), 160);

// Short, key-free, single-line reason for the log and the thrown error.
function describe(e) {
  const detail = () => oneLine(e.error?.error?.message || e.message);
  if (e instanceof TimeoutError || e instanceof Anthropic.APIConnectionTimeoutError) return 'timed out';
  if (e instanceof Anthropic.APIUserAbortError) return 'aborted';
  if (e instanceof Anthropic.AuthenticationError) return 'API key rejected (401)';
  if (e instanceof Anthropic.PermissionDeniedError) return 'permission denied (403)';
  if (e instanceof Anthropic.NotFoundError) return `model not found (${config.anthropicModel})`;
  if (e instanceof Anthropic.RateLimitError) return 'rate limited (429)';
  if (e instanceof Anthropic.BadRequestError) return `bad request: ${detail()}`;
  if (e instanceof Anthropic.APIConnectionError) return 'connection failed';
  if (e instanceof Anthropic.APIError) return `API error ${e.status ?? ''}: ${detail()}`;
  return oneLine(e?.message || String(e));
}

// ---------- images ----------

const b64Of = (img) => (typeof img?.data === 'string' ? img.data.replace(/^data:[^,]*,/, '').replace(/\s+/g, '') : '');

// The API rejects the whole request if an image's bytes don't match its media_type (e.g. a HEIC
// that sharp couldn't convert), so the type is read from the data and anything else is skipped.
function sniffType(b64) {
  const head = Buffer.from(b64.slice(0, 16), 'base64');
  const ascii = (a, b) => head.toString('latin1', a, b);
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 3) === 'GIF') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// Keeps each image's original index so replies can point back into the caller's list.
function usable(images) {
  const list = Array.isArray(images) ? images : [];
  const ok = [];
  list.forEach((img, index) => {
    const data = b64Of(img);
    const mediaType = data.length <= MAX_IMAGE_B64 ? sniffType(data) : null;
    if (mediaType) ok.push({ index, data, mediaType });
  });
  if (ok.length < list.length) warn(`claude: skipped ${list.length - ok.length} empty, oversized or unsupported image(s)`);
  return ok;
}

// A short text label before each image ("Photo 3:") so Claude can refer to it by number.
function imageBlocks(shots, name) {
  return shots.flatMap((shot, i) => [
    { type: 'text', text: `${name(shot, i)}:` },
    { type: 'image', source: { type: 'base64', media_type: shot.mediaType, data: shot.data } },
  ]);
}

// ---------- cleaning model output ----------

const NULLISH = new Set(['', 'null', 'none', 'n/a', 'na', 'unknown', 'not visible', 'not sure']);

// Trimmed one-line string, or null for empty and placeholder values.
function str(v, max = 300) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return NULLISH.has(s.toLowerCase()) ? null : clip(s, max);
}

function strList(v, maxItems, maxLen = 120) {
  const out = [];
  for (const x of Array.isArray(v) ? v : []) {
    const s = str(x, maxLen);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out.slice(0, maxItems);
}

// Structured outputs don't guarantee enum casing, so match case-insensitively.
function pick(v, allowed, fallback) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return allowed.find((a) => a.toLowerCase() === s) ?? fallback;
}

// Claude answers money in pounds (more reliable than pence); we store pence.
const poundsToPence = (v) => (typeof v === 'number' ? toPence(v * 100) : null);

const titleCase = (s) => s.replace(/(^|\s)(\p{L})/gu, (_, sp, c) => sp + c.toUpperCase());

const quoted = (s) => (s ? `"""\n${s}\n"""` : 'nothing');

const lines = (list) => (Array.isArray(list) && list.length ? list.map((x) => `- ${x}`).join('\n') : 'none');

// ---------- schemas ----------
// Structured outputs need additionalProperties:false and every key in required; nullable = type [x, 'null'].

const S = { type: 'string' };
const S_NULL = { type: ['string', 'null'] };
const N_NULL = { type: ['number', 'null'] };
const I_NULL = { type: ['integer', 'null'] };
const S_LIST = { type: 'array', items: S };
const oneOf = (values) => ({ type: 'string', enum: values });
const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

// Key order is generation order: evidence first, verdicts after.
const ESTIMATE_SCHEMA = object({
  items: {
    type: 'array',
    items: object({
      label: S,
      brand: S_NULL,
      brand_tier: oneOf(TIERS),
      type: oneOf(TYPES),
      type_label: S,
      size: S_NULL,
      condition_notes: S_LIST,
      special: S_NULL,
      seller_story: S_NULL,
      claim: S_NULL,
      claim_noun: S_NULL,
      story_safe: S_NULL,
      proof_request: S_NULL,
      seller_ask_pounds: N_NULL,
      search_query: S,
    }),
  },
});

const PHOTOS_SCHEMA = object({
  shots: S_LIST, // Claude's per-photo checklist; not returned
  brand: S_NULL,
  size: S_NULL,
  condition_notes: S_LIST,
  grade: oneOf(GRADES),
  special: S_NULL,
  claim_proof_index: I_NULL,
  photo_requests: S_LIST,
  request_summary: S_NULL,
});

const COMPS_SCHEMA = object({
  matches: { type: 'array', items: object({ index: { type: 'integer' }, price_pounds: { type: 'number' } }) },
});

const DESCRIPTION_SCHEMA = object({ title: S, body: S, proof_line: S_NULL });

export const SCHEMAS = {
  estimate: ESTIMATE_SCHEMA,
  photos: PHOTOS_SCHEMA,
  comps: COMPS_SCHEMA,
  description: DESCRIPTION_SCHEMA,
};

// ---------- estimatePile ----------

const ESTIMATE_SYSTEM = `You are the eyes and ears of offload, a London service that sells people's unwanted clothes for them. A seller has filmed their pile on their phone and talked about it as they went. You get frames from that video, in order, and a transcript of what they said. List every distinct clothing item so we can give the seller a price range and start preparing the listings.

Finding items
- One entry per distinct physical item. The same item shows up across many frames and angles: count it once. Only list two similar items separately if you can see both at once or the seller says there are two.
- Clothing and shoes only. Ignore the room, furniture, hangers, bags, and whatever the seller is wearing.
- If the seller clearly describes an item that never appears on camera, still include it.
- Keep the order they appear in the video.

Fields (keep every string short)
- label: what a person would call it, brand first when known: "Levi's denim jacket", "grey Nike hoodie", "floral midi dress". No size. Keep claims out: no "signed", "worn by", "authentic" or "made by <person>" (write "Lakers Kobe Bryant jersey", not "signed Lakers jersey"). Things buyers can see, like "hand-painted" or "embroidered", are fine.
- brand: only if you can read it on a label, logo or tag, or the seller says it. Never guess a brand from the style. Otherwise null.
- brand_tier:
  designer: luxury houses such as Gucci, Prada, Burberry, Vivienne Westwood, Moncler, Balenciaga.
  premium: Carhartt, Ralph Lauren, Stone Island, Arc'teryx, Patagonia, The North Face, Barbour, and vintage Levi's, Nike, Harley-Davidson and similar.
  high street: Zara, H&M, Primark, Uniqlo, Topshop, Next, and modern Nike or Adidas basics.
  unknown: no brand visible or said.
- type: exactly one of jacket, jeans, hoodie, t-shirt, dress, trainers, other.
  Coats, blazers, gilets, fleeces -> jacket. Sweatshirts, jumpers, cardigans, knitwear -> hoodie. Shirts, polos, tees, tops, vests -> t-shirt. Denim jeans -> jeans. Trainers and sneakers -> trainers. Skirts, trousers, shorts, boots, other shoes and anything else -> other.
- type_label: the specific kind of item, for search and listings: "denim trucker jacket", "crewneck sweatshirt", "slip dress", "high-top trainers".
- size: only if a size tag is legible or the seller says it ("it's a medium" -> "M", "size 10", "32W 30L", "UK 9"). Otherwise null.
- condition_notes: flaws visible in the frames or mentioned by the seller, short and specific: "small mark on left sleeve", "frayed hem", "missing top button". Empty list if none.
- special: only something a buyer would pay extra for: limited edition, rare collab, deadstock with tags, original 90s tour print, made in USA. Otherwise null.
- seller_story: what the seller said about THIS item, taken from their part of the transcript. Keep their details and history (where they got it, how they wore it, why it's going) in their own words; first person is fine. Clean it up: drop filler, false starts, talk aimed at the camera, prices, and anything about other items. Add nothing they didn't say. null if they said nothing about it.
- seller_ask_pounds: a price the seller wants for this item, in pounds: "I want £80 for it" -> 80, "eighty quid" -> 80, "at least 50" -> 50, "a tenner" -> 10. What they paid for it is not an ask, and neither is a price for the whole pile. Otherwise null.
- search_query: what we'd type into eBay or Depop to find similar items. Branded: brand + type_label + size, e.g. "Levi's denim trucker jacket M". No brand: era, style, material and standout features, e.g. "90s embroidered denim jacket patches". No condition words or prices.

Claims
A claim is something the seller says that we can't check from the video but that changes the item's value or story: a signature, a famous previous owner, hand-made or customised work, "worn on stage", the authenticity of a designer piece. Ordinary history ("got it in Camden", "only worn twice") is not a claim.
When there is a claim:
- claim: a short phrase that reads naturally after "it's", about the seller in the third person: "signed by Kobe Bryant", "hand-painted by the seller's sister", "customised by the seller".
- claim_noun: what a close-up photo of it would show: "the signature", "the painted back", "the custom embroidery".
- story_safe: seller_story with the claim taken out and everything else kept; null if nothing is left.
- proof_request: one friendly question asking the seller for evidence that fits the claim, starting "You said it's": "You said it's signed by Kobe Bryant. Do you have a photo of it being signed, a receipt or a certificate?", "You said it's hand-painted by your sister. Do you have any photos of it being painted?"
With no claim, all four are null.

Never invent brands, sizes, flaws or claims. When unsure, use null. If there is no clothing at all, return an empty items list. Write in British English.`;

function estimateText(frameCount, transcript, sellerName) {
  return [
    `Seller: ${sellerName || 'unknown'}`,
    frameCount
      ? `Above ${frameCount === 1 ? 'is 1 frame' : `are ${frameCount} frames`} from the video, in order.`
      : 'No video frames came through, so work from the transcript.',
    `What the seller said while filming:\n${transcript ? quoted(transcript) : '(nothing)'}`,
    'List every clothing item in the pile.',
  ].join('\n\n');
}

function cleanClaim(v) {
  const s = str(v, 120);
  return s ? s.replace(/^(it'?s|it is)\s+/i, '').replace(/[.!\s]+$/, '') || null : null;
}

// Reads after "Close-up of" and "proof of", so it needs a determiner: "signature" -> "the signature".
function cleanNoun(v) {
  const s = str(v, 60)?.replace(/[.\s]+$/, '');
  if (!s) return 'the detail';
  return /^(the|a|an|his|her|their|its)\s/i.test(s) ? s : `the ${s}`;
}

function cleanEstimateItem(raw) {
  const brand = str(raw?.brand, 60);
  const type = pick(raw?.type, TYPES, 'other');
  const type_label = str(raw?.type_label, 60) || type;
  const size = str(raw?.size, 30);
  const claim = cleanClaim(raw?.claim);
  const claim_noun = claim ? cleanNoun(raw?.claim_noun) : null;
  return {
    label: str(raw?.label, 80) || [brand, type_label].filter(Boolean).join(' '),
    brand,
    type,
    type_label,
    size,
    brand_tier: brand ? pick(raw?.brand_tier, TIERS, 'unknown') : 'unknown',
    condition_notes: strList(raw?.condition_notes, 6),
    special: str(raw?.special, 120),
    claim,
    claim_noun,
    claim_line: claim ? `Seller says it's ${claim}. Close-up of ${claim_noun} included.` : null,
    seller_ask: poundsToPence(raw?.seller_ask_pounds),
    seller_story: str(raw?.seller_story, 1200),
    story_safe: claim ? str(raw?.story_safe, 1200) : null,
    proof_request: claim
      ? str(raw?.proof_request, 240) || `You said it's ${claim}. Do you have a photo, a receipt or anything else that shows it?`
      : null,
    search_query: str(raw?.search_query, 100) || [brand, type_label, size].filter(Boolean).join(' '),
  };
}

export async function estimatePile({ frames = [], transcript = '', sellerName = '' } = {}) {
  requireKey();
  const shots = sample(usable(frames), MAX_FRAMES);
  const said = typeof transcript === 'string' ? transcript.trim() : '';
  if (!shots.length && !said) fail('estimate', 'no frames or transcript');
  const out = await callClaude('estimate', {
    system: ESTIMATE_SYSTEM,
    content: [
      ...imageBlocks(shots, (_, i) => `Frame ${i + 1}`),
      { type: 'text', text: estimateText(shots.length, said, sellerName) },
    ],
    schema: ESTIMATE_SCHEMA,
    maxTokens: 8000, // room for a big pile; a cut-off reply loses every item
    timeoutMs: config.timeouts.estimate,
  });
  const items = Array.isArray(out.items) ? out.items : [];
  return { items: items.slice(0, 25).map(cleanEstimateItem) };
}

// ---------- checkPhotos ----------

const PHOTOS_SYSTEM = `You check a runner's photos of one clothing item before offload lists it for sale, then grade it. The runner is standing next to the item with a phone, so anything you ask for must be a plain, doable instruction. Photos are labelled "Photo 0", "Photo 1" and so on.

Work through it in this order:
- shots: one short line per photo saying what it shows and whether it's usable, e.g. "Photo 0: front, laid flat, sharp", "Photo 3: signature, blurry". This is your checklist.
- brand and size: read them from the label or size tag if legible. null if you can't read them.
- condition_notes: honest, specific and short, the way a buyer would want to know: "small ink mark on left cuff", "light fading on the knees". Keep the notes you were given unless the photos clearly show they're wrong, and add any new flaws you see. Empty list if the item is clean. No filler like "good condition".
- grade, from the photos plus what the seller said:
  A: like new, no visible flaws
  B: light wear or one minor flaw
  C: clear wear or several marks
  D: heavy damage, stains or holes
- special: only genuine limited editions, rare runs, collabs, deadstock with tags or notable vintage details (e.g. "single-stitch 90s tour tee", "made in USA"). Keep the one you were given unless the photos contradict it. Otherwise null.
- claim_proof_index: if the seller made a claim, the number of a photo that shows the claimed feature clearly and close up. null if there's no claim or no such photo. You're not judging whether the claim is true, only whether the photo shows it clearly.
- photo_requests: what's missing or unusable. A sellable set needs:
  1. the front, whole item in frame
  2. the back
  3. the label or size tag, if the item has one. If the photos show it has no label, don't ask for one.
  4. every flaw in your condition_notes, close enough to see
  5. if there's a claim, a sharp close-up of the claimed feature
  Blurry, dark, cut off or too far away counts as missing. One instruction per problem, most important first, at most 3, spoken to the runner: "Get a photo of the back, laid flat", "The signature is blurry, get a close-up in good light", "Get the care label so the size is readable". Empty list when the set is good enough to sell.
  In lenient mode the runner has already retaken photos twice: only ask if the item can't be sold from these photos at all, e.g. there's no usable view of the front.
- request_summary: the requests squeezed into a short phrase that completes "Asked the runner for ___.", e.g. "a clearer shot of the signature", "photos of the back and the label". null when there are no requests.

Write in British English.`;

function photosText(item, shots, lenient) {
  const claim = item.claim
    ? `it's ${item.claim}. A sharp close-up of ${item.claim_noun || 'the claimed feature'} is needed.`
    : 'none';
  return [
    `Item: ${item.label || 'clothing item'}`,
    `Brand: ${item.brand || 'not known yet'}`,
    `Type: ${item.type_label || item.type || 'not known'}`,
    `Size: ${item.size || 'not known yet'}`,
    `Seller's claim: ${claim}`,
    `Condition notes so far:\n${lines(item.condition_notes)}`,
    `Special so far: ${item.special || 'none'}`,
    `What the seller said about it:\n${quoted(item.seller_story)}`,
    `Photos above: ${shots.map((s) => `Photo ${s.index}`).join(', ')}.`,
    lenient ? 'Mode: lenient. Only flag photos that make the item unsellable.' : 'Mode: normal.',
  ].join('\n');
}

function cleanSummary(v) {
  const s = str(v, 100)
    ?.replace(/^asked the runner for\s+/i, '')
    .replace(/[.\s]+$/, '');
  if (!s) return null;
  return /^(A|An|The|Some|Another|More|Photos?|Clearer)\b/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

function cleanPhotoCheck(raw, item, sentIndices) {
  const photo_requests = strList(raw.photo_requests, 3, 160);
  const idx = raw.claim_proof_index;
  return {
    photo_requests,
    request_summary: photo_requests.length ? cleanSummary(raw.request_summary) || 'a few retakes' : null,
    grade: pick(raw.grade, GRADES, 'B'),
    condition_notes: strList(raw.condition_notes, 6),
    special: str(raw.special, 120),
    claim_proof_index: item.claim && Number.isInteger(idx) && sentIndices.includes(idx) ? idx : null,
    brand: str(raw.brand, 60),
    size: str(raw.size, 30),
  };
}

export async function checkPhotos({ item = {}, photos = [], lenient = false } = {}) {
  requireKey();
  const shots = usable(photos).slice(-MAX_PHOTOS); // the most recent ones include any retakes
  if (!shots.length) fail('photos', 'no usable photos');
  const out = await callClaude('photos', {
    system: PHOTOS_SYSTEM,
    content: [
      ...imageBlocks(shots, (shot) => `Photo ${shot.index}`),
      { type: 'text', text: photosText(item || {}, shots, Boolean(lenient)) },
    ],
    schema: PHOTOS_SCHEMA,
    maxTokens: 1200,
    timeoutMs: config.timeouts.photos,
  });
  return cleanPhotoCheck(out, item || {}, shots.map((s) => s.index));
}

// ---------- filterComps ----------

const COMPS_SYSTEM = `You pick price comparisons for a secondhand clothing listing. You get our item and search results from eBay, Depop, ASOS Marketplace and Vestiaire Collective. Keep only genuinely close matches, so the middle price means something.

Keep a result when it is:
- the same kind of item (a denim jacket for a denim jacket, not jeans or a shirt)
- the same brand, if our item has one
- a similar era, style and material, if our item has no brand
- a single adult item for sale. Size differences are fine.

Drop:
- lots, bundles, job lots and multi-packs
- kids' or baby sizes
- accessories, patches, parts and sewing patterns
- "wanted" or "ISO" posts, search pages, category pages and articles
- prices that are clearly postage, a deposit or a 99p starting bid
- a different model, fakes, or "style" and "inspired by" items when ours is branded

price_pounds: the item's price in pounds. The parsed price can be wrong (postage, a bid or another number in the text), so correct it from the title and snippet. If you can't tell the real price, drop the result.

Best match first, at most 5. An empty list is a valid, honest answer when nothing is close.`;

function compsText(query, item, list) {
  const results = list.map((c, i) => {
    const price = c?.price ? gbp(c.price) : 'none found';
    const head = `[${i}] ${c?.source || 'web'} | ${clip(c?.title || '', 160)} | parsed price: ${price} | ${clip(c?.url || '', 120)}`;
    return c?.snippet ? `${head}\n    ${clip(String(c.snippet).replace(/\s+/g, ' '), 320)}` : head;
  });
  return [
    `Our item: ${item.label || 'clothing item'}`,
    `Brand: ${item.brand || 'none (unbranded or unknown)'}`,
    `Type: ${item.type_label || 'not known'}`,
    `Size: ${item.size || 'not known'}`,
    `Search used: ${query || 'n/a'}`,
    '',
    'Results:',
    ...results,
  ].join('\n');
}

function cleanMatches(raw, list) {
  const matches = [];
  for (const m of Array.isArray(raw) ? raw : []) {
    const index = m?.index;
    if (!Number.isInteger(index) || index < 0 || index >= list.length) continue;
    if (matches.some((x) => x.index === index)) continue;
    const price = poundsToPence(m.price_pounds) ?? toPence(list[index]?.price);
    if (!price || price < MIN_COMP_PRICE) continue;
    matches.push({ index, price });
    if (matches.length === MAX_MATCHES) break;
  }
  return matches;
}

export async function filterComps({ query = '', item = {}, candidates = [] } = {}) {
  requireKey();
  const list = (Array.isArray(candidates) ? candidates : []).slice(0, MAX_CANDIDATES);
  if (!list.length) return { matches: [] };
  const out = await callClaude('comps', {
    system: COMPS_SYSTEM,
    content: [{ type: 'text', text: compsText(query, item || {}, list) }],
    schema: COMPS_SCHEMA,
    maxTokens: 800,
    timeoutMs: config.timeouts.comps,
  });
  return { matches: cleanMatches(out.matches, list) };
}

// ---------- writeDescription ----------

const DESCRIPTION_SYSTEM = `You write the description for a secondhand clothing listing in offload's shop. Write like a friendly person selling their own clothes on Depop: plain, warm, specific and short.

body
- 2 or 3 short paragraphs separated by a blank line. Plain text only: no markdown, bullet points, headings, hashtags or emoji.
- Start with the seller's story, keeping their details, history and voice (first person is fine). Tidy the wording but add nothing: no invented history, fit, fabric or measurements. If there's no story, open with a plain line about the item itself.
- Then the condition, stated honestly. Name every flaw in the condition notes. Say what the grade means in everyday words (A like new, B lightly worn, C worn with visible marks, D heavily worn with damage).
- Mention the size and any special detail if given.
- Never mention a price, offers, links, postage, offload or AI. Never add anything about signatures, famous owners, authenticity or custom work beyond what the story you're given says.

title: a short product title in title case with brand, item and size, e.g. "Levi's Denim Trucker Jacket, Size M". Leave out the brand or size if unknown. Under 70 characters. Never put a claim in the title (signed, worn by, authentic, made by someone): describe only what the photos show.

proof_line: only when has_proof is yes. One short sentence saying the seller has shared proof, based on their proof note, without stating the claim as fact, e.g. "Seller has shared a photo from the signing." Otherwise null.

Write in British English.`;

const GRADE_WORDS = {
  A: 'like new, no visible flaws',
  B: 'light wear or one minor flaw',
  C: 'clear wear or several marks',
  D: 'heavy damage, stains or holes',
};

function descriptionText(d) {
  const grade = pick(d.grade, GRADES, null);
  return [
    `Item: ${d.label || d.type_label || 'clothing item'}`,
    `Brand: ${d.brand || 'none'}`,
    `Type: ${d.type_label || 'not known'}`,
    `Size: ${d.size || 'not known'}`,
    `Grade: ${grade ? `${grade} (${GRADE_WORDS[grade]})` : 'not graded'}`,
    `Condition notes:\n${lines(d.condition_notes)}`,
    `Special: ${d.special || 'none'}`,
    `Seller's story:\n${quoted(d.story)}`,
    d.has_proof ? `has_proof: yes. The seller's proof note:\n${quoted(d.proof_note)}` : 'has_proof: no',
  ].join('\n');
}

// Plain paragraphs only: no headings, markdown or links (a sentence with a link goes entirely).
function cleanBody(v) {
  if (typeof v !== 'string') return '';
  const text = v
    .replace(/\r/g, '')
    .replace(/^\s*#+.*$/gm, '')
    .replace(/[^.!?\n]*https?:\/\/\S+[^.!?\n]*[.!?]?/g, '');
  const parts = text.includes('\n\n') ? text.split(/\n\s*\n/) : text.split('\n');
  return parts
    .map((p) =>
      p
        .replace(/^\s*(#+|[-*•])\s+/gm, '')
        .replace(/\*\*|__/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n\n');
}

function fallbackTitle({ label, brand, type_label, size }) {
  const name = type_label ? [brand, type_label].filter(Boolean).join(' ') : label || 'Preloved Item';
  return titleCase(name) + (size ? `, Size ${size}` : '');
}

export async function writeDescription(d = {}) {
  requireKey();
  const out = await callClaude('description', {
    system: DESCRIPTION_SYSTEM,
    content: [{ type: 'text', text: descriptionText(d) }],
    schema: DESCRIPTION_SCHEMA,
    maxTokens: 900,
    timeoutMs: config.timeouts.text,
  });
  const body = cleanBody(out.body);
  if (!body) fail('description', 'empty body');
  return {
    title: str(out.title, 120) || fallbackTitle(d),
    body,
    proof_line: d.has_proof ? str(out.proof_line, 200) || 'Seller has shared a photo as proof.' : null,
  };
}
