// Live filming prompts: one camera frame + the last words spoken -> one prompt from a fixed list.
// Gemini REST (v1beta generateContent) over fetch. Latency first: tiny request, no thinking, low image tokens.
import { config, has } from './config.js';
import { log, warn, clip, TimeoutError } from './util.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
// Used only when ListModels is unreachable or lists no Flash model; the warm-up skips any that 404.
const FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-flash-latest'];
const TRANSCRIPT_TAIL = 300;
const WARMUP_CANDIDATES = 3;

export const PROMPTS = [
  'Show me the label',
  'Turn it round',
  'Any marks or damage?',
  'Show the size tag',
  'Anything special about it?',
  'What would you want for this one?',
  'Show me the signature or the change up close',
  'Hold it up flat',
  'Got it, next item',
  'Looks good, you can stop',
];

const SYSTEM = `You coach someone filming their pile of clothes on their phone so each item can be resold. Each turn you get one camera frame and the last thing they said.
Reply as JSON {"notes": "...", "prompt": "..."}. notes first: one short line, 12 words max, of what you see (like "grey hoodie, no brand visible yet"). Then prompt: exactly ONE of these, word for word, for what they should do next: ${PROMPTS.map((p) => `"${p}"`).join(', ')}.
Rough order of priority:
- They say that's everything or the pile is done: "Looks good, you can stop".
- A signature, writing or modification is visible or they mention one: "Show me the signature or the change up close". Once they've shown it close up, ask "What would you want for this one?".
- New item and no label seen yet: "Show me the label".
- Something unusual (no label at all once they've looked, hand-made changes, writing, patches, paint): "What would you want for this one?" or "Anything special about it?".
- Size still unknown: "Show the size tag".
- Only one side seen: "Turn it round".
- Wear not checked yet: "Any marks or damage?".
- Creased or bunched up, hard to see: "Hold it up flat".
- Item fully covered: "Got it, next item".
Don't repeat the previous prompt unless it is still clearly needed. If the frame is dark, blurry or empty, pick the prompt that gets them back on track.`;

// OpenAPI-subset schema for responseSchema. notes comes first so the model looks before it picks.
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    notes: { type: 'STRING', description: 'One short line, 12 words max, of what is in the frame.' },
    prompt: { type: 'STRING', enum: PROMPTS, description: 'What they should do next.' },
  },
  required: ['notes', 'prompt'],
  propertyOrdering: ['notes', 'prompt'],
};

// Same schema as plain JSON Schema for generationConfig.responseFormat (responseSchema is marked deprecated).
// Output follows the key order of `properties`.
const JSON_SCHEMA = {
  type: 'object',
  properties: {
    notes: { type: 'string', description: SCHEMA.properties.notes.description },
    prompt: { type: 'string', enum: PROMPTS, description: SCHEMA.properties.prompt.description },
  },
  required: ['notes', 'prompt'],
  additionalProperties: false,
};

// ---------- model picking ----------

const SKIP = /image|tts|audio|live|native|embedding|thinking|robotics|computer-use|transcribe|translate/;
// gemini-2.5-flash, gemini-3.5-flash-lite, gemini-3-flash-preview, gemini-flash-lite-latest ...
const FLASH = /^gemini-(?:(\d+)(?:\.(\d+))?-)?flash(-lite)?(?:-(.+))?$/;

// Sort key for a general text+vision Flash model, or null for anything else.
function rankOf(id) {
  if (SKIP.test(id)) return null;
  const m = FLASH.exec(id);
  if (!m) return null;
  return {
    lite: m[3] ? 1 : 0,
    major: Number(m[1] || 0), // "-latest" aliases have no version, so they rank last in their tier
    minor: Number(m[2] || 0),
    stable: /preview|exp/.test(m[4] || '') ? 0 : 1,
  };
}

// flash-lite before flash, newest version first, stable before preview/exp, then the plainest name.
function byRank({ id: ia, rank: a }, { id: ib, rank: b }) {
  return b.lite - a.lite || b.major - a.major || b.minor - a.minor || b.stable - a.stable || ia.length - ib.length;
}

async function listModels(signal) {
  const models = [];
  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ pageSize: '1000' });
    if (pageToken) qs.set('pageToken', pageToken);
    const data = await request(`models?${qs}`, null, signal);
    models.push(...(data.models || []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return models;
}

const bareId = (name) => String(name || '').replace(/^models\//, '').trim();

// Ranked Flash models that support generateContent; remembers which ones report thinking support.
function rankModels(models) {
  const out = [];
  for (const m of models) {
    if (!m.supportedGenerationMethods?.includes('generateContent')) continue;
    const id = bareId(m.name);
    const rank = rankOf(id);
    if (!rank) continue;
    if (typeof m.thinking === 'boolean') thinks.set(id, m.thinking);
    out.push({ id, rank });
  }
  return out.sort(byRank).map((c) => c.id);
}

// ---------- per-model settings, learned from 400s ----------

const thinks = new Map(); // model id -> the `thinking` flag from ListModels
const tuning = new Map(); // model id -> { thinking, media, format ladders; t, m, f = current rung of each }

function family(model) {
  const m = /^gemini-(\d+)(?:\.(\d+))?-/.exec(model);
  if (!m) return 'unknown';
  const major = Number(m[1]);
  const minor = Number(m[2] || 0);
  if (major >= 3) return '3';
  if (major === 2 && minor >= 5) return '2.5';
  return 'old';
}

// Settings to try, fastest first. A 400 naming one of them steps down a rung for that model.
function ladders(model) {
  const fam = family(model);
  const noThinking = thinks.get(model) === false || fam === 'old';
  const thinking = noThinking
    ? [null]
    : fam === '2.5'
      ? [{ thinkingBudget: 0 }, null]
      : fam === '3'
        ? [{ thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, null] // 3.7/3.8 Flash reject minimal
        : [{ thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, { thinkingBudget: 0 }, null];
  // ~280 image tokens on Gemini 3 (default 1120); ~256 on 2.x (default adds pan & scan).
  const media = fam === '3' ? ['MEDIA_RESOLUTION_LOW', null] : ['MEDIA_RESOLUTION_MEDIUM', null];
  // responseSchema works on every model but is marked deprecated; responseFormat is the documented
  // replacement. Last resort is JSON mode alone (the system prompt spells out the shape; parseReply validates).
  const format = ['responseSchema', 'responseFormat', 'jsonOnly'];
  return { thinking, media, format, t: 0, m: 0, f: 0 };
}

function tuningFor(model) {
  if (!tuning.has(model)) tuning.set(model, ladders(model));
  return tuning.get(model);
}

function generationConfig(model, st) {
  const thinking = st.thinking[st.t];
  const media = st.media[st.m];
  const thinkingOff = thinking?.thinkingBudget === 0 || st.thinking.length === 1;
  const gc = { maxOutputTokens: thinkingOff ? 128 : 384 }; // thinking tokens count against this cap
  const format = st.format[st.f];
  if (format === 'responseFormat') {
    gc.responseFormat = { text: { mimeType: 'application/json', schema: JSON_SCHEMA } };
  } else {
    gc.responseMimeType = 'application/json';
    if (format === 'responseSchema') gc.responseSchema = SCHEMA;
  }
  // Gemini 3 wants the default temperature (3.8 deprecates it); older models get a low one.
  if (family(model) === '2.5' || family(model) === 'old') gc.temperature = 0.2;
  if (thinking) gc.thinkingConfig = thinking;
  if (media) gc.mediaResolution = media;
  return gc;
}

// Optional settings a 400 can name: [rung key, ladder, what the error message mentions, label].
const KNOBS = [
  ['t', 'thinking', /think/i, 'thinking'],
  ['m', 'media', /media|resolution/i, 'media resolution'],
  ['f', 'format', /schema|response_?format|response_?mime/i, 'response format'],
];

// A 400 that names an optional setting: drop to the next rung for this model. Returns true to retry.
// `used` is the rung the failed request was sent with; if a concurrent call already stepped, just retry.
function stepPast(err, model, st, used) {
  if (err.status !== 400) return false;
  const msg = err.detail || '';
  for (const [key, ladder, re, label] of KNOBS) {
    if (!re.test(msg)) continue;
    if (st[key] !== used[key]) return true;
    if (st[key] < st[ladder].length - 1) {
      st[key]++;
      const next = st[ladder][st[key]];
      log(`gemini: ${model} ${label} -> ${next == null ? 'model default' : typeof next === 'string' ? next : JSON.stringify(next)}`);
      return true;
    }
  }
  return false;
}

// ---------- HTTP ----------

// GET (body null) or POST JSON. Throws on HTTP errors with .status and the full .detail message.
async function request(path, body, signal) {
  const headers = { 'x-goog-api-key': config.geminiKey };
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${API}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // non-JSON error page; handled below
  }
  if (!res.ok) {
    // Google can echo a bad inline_data value back in the message; keep base64 out of the logs.
    const detail = String(data?.error?.message || text || res.statusText || '').replace(/[A-Za-z0-9+/=_-]{48,}/g, '[data]');
    const err = new Error(`HTTP ${res.status}: ${clip(detail.replace(/\s+/g, ' '), 140)}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  if (!data) throw new Error('Gemini sent back something that is not JSON');
  return data;
}

// Runs fn(signal) and aborts everything it started at ms; the abort surfaces as a TimeoutError.
async function withDeadline(ms, label, fn) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } catch (e) {
    if (ctrl.signal.aborted) throw new TimeoutError(label, ms);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function generate(model, contents, signal) {
  const st = tuningFor(model);
  for (;;) {
    const used = { t: st.t, m: st.m, f: st.f };
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents,
      generationConfig: generationConfig(model, st),
    };
    try {
      return await request(`models/${encodeURIComponent(model)}:generateContent`, body, signal);
    } catch (e) {
      if (!stepPast(e, model, st, used)) throw e;
    }
  }
}

// ---------- reply parsing ----------

const promptKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z ]+/g, '').replace(/\s+/g, ' ').trim();
const BY_KEY = new Map(PROMPTS.map((p) => [promptKey(p), p]));

function parseReply(data) {
  const block = data.promptFeedback?.blockReason;
  if (block) throw new Error(`blocked: ${block}`);
  const cand = data.candidates?.[0];
  if (!cand) throw new Error('no candidates');
  const reason = cand.finishReason;
  if (reason && reason !== 'STOP' && reason !== 'MAX_TOKENS') throw new Error(`stopped: ${reason}`);

  const text = (cand.content?.parts || [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();
  if (!text) throw new Error(`empty reply${reason ? ` (${reason})` : ''}`);

  let out;
  try {
    out = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new Error(`reply was not JSON${reason === 'MAX_TOKENS' ? ' (hit max tokens)' : ''}`);
  }
  const prompt = BY_KEY.get(promptKey(out?.prompt));
  if (!prompt) throw new Error(`prompt not in list: ${clip(String(out?.prompt), 60)}`);
  const notes = typeof out.notes === 'string' ? clip(out.notes.replace(/\s+/g, ' ').trim(), 90) : '';
  return { prompt, notes };
}

// Last ~n characters, starting on a word.
function tail(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const cut = s.slice(-n);
  const space = cut.indexOf(' ');
  return '…' + (space > 0 && space < 30 ? cut.slice(space + 1) : cut);
}

function userText(transcript, previousPrompt) {
  const said = tail(transcript, TRANSCRIPT_TAIL);
  const prev = previousPrompt ? `"${clip(String(previousPrompt), 80)}"` : 'none yet';
  return `Previous prompt: ${prev}\nLast words from the seller: ${said ? `"${said}"` : '(nothing yet)'}`;
}

// ---------- init + live ----------

let chosen = null; // model id in use
let picking = null; // resolves once a model is chosen (before the warm-up finishes)
let booting = null; // the whole init()
let bootRunning = false;
let lastBoot = 0;
let settled = false; // ListModels or a warm-up answered, so `chosen` is more than a guess
const REPICK_MS = 30000;

const configuredModel = () => bareId(config.geminiModel);

// Ranked candidates: the configured model, else ListModels. Null when the key is rejected.
async function candidates() {
  if (configuredModel()) return [configuredModel()];
  try {
    const models = await withDeadline(config.timeouts.text, 'gemini list models', listModels);
    settled = true;
    const ranked = rankModels(models);
    if (ranked.length) return ranked;
    warn(`gemini: no Flash model in ListModels (${models.length} models), trying ${FALLBACK_MODELS[0]}`);
  } catch (e) {
    if ([400, 401, 403].includes(e.status)) {
      warn(`gemini: key rejected listing models: ${e.message}`);
      return null;
    }
    warn(`gemini: could not list models (${e.message}), trying ${FALLBACK_MODELS[0]}`);
  }
  return [...FALLBACK_MODELS];
}

// One tiny text-only call so the first real frame is not a cold start. Also learns the thinking rung.
async function warmUp(model) {
  const started = Date.now();
  const contents = [{ role: 'user', parts: [{ text: `Warm-up, no frame yet.\n${userText('', null)}` }] }];
  await withDeadline(Math.min(config.timeouts.text, 6000), 'gemini warm-up', (signal) => generate(model, contents, signal));
  log(`gemini: warmed ${model} in ${Date.now() - started}ms`);
}

// 404/403/429 or an unfixable 400 on the warm-up means this model is no use to this key.
const unusable = (e) => [400, 403, 404, 429].includes(e.status);

async function boot() {
  if (!has.gemini()) {
    warn('gemini: no GEMINI_API_KEY, live prompts are off');
    return null;
  }
  picking = candidates();
  const list = await picking.then((l) => l || [], () => []);
  if (!list.length) return null;
  chosen = list[0];
  log(`gemini: using ${chosen}${configuredModel() ? ' (GEMINI_MODEL)' : ''}`);

  for (const model of list.slice(0, WARMUP_CANDIDATES)) {
    chosen = model;
    try {
      await warmUp(model);
      settled = true;
      if (model !== list[0]) log(`gemini: using ${model} instead`);
      return model;
    } catch (e) {
      warn(`gemini: warm-up on ${model} failed: ${e.message}`);
      if (!unusable(e) || configuredModel()) return model; // slow or flaky, not unusable: keep it
    }
  }
  chosen = list[0]; // nothing warmed; stay on the best pick and let live calls report errors
  return chosen;
}

// Picks the model (config.geminiModel or the fastest Flash the key can see) and warms it. Never throws.
export function init() {
  // A boot that only guessed (offline or no DNS at the time) runs again, at most every 30 s.
  if (booting && !bootRunning && !settled && Date.now() - lastBoot >= REPICK_MS) booting = null;
  if (!booting) {
    lastBoot = Date.now();
    bootRunning = true;
    booting = boot()
      .catch((e) => {
        warn(`gemini: init failed: ${e.message}`);
        return chosen;
      })
      .finally(() => (bootRunning = false));
  }
  return booting;
}

// The model to call now; waits for an in-flight pick only as long as the caller's deadline allows.
async function modelFor(signal) {
  if (configuredModel()) return configuredModel();
  if (chosen) {
    if (!settled) init(); // re-picks in the background; this call keeps the current model
    return chosen;
  }
  init();
  const aborted = new Promise((resolve) => signal.addEventListener('abort', () => resolve(null), { once: true }));
  const list = await Promise.race([picking, aborted]);
  if (signal.aborted) throw new Error('aborted');
  if (!list?.length) throw new Error('no Gemini model available');
  return chosen || list[0];
}

export async function livePrompt({ frame, transcript = '', previousPrompt = null, timeoutMs } = {}) {
  if (!has.gemini()) throw new Error('not configured');
  const data = String(frame?.data || '').replace(/^data:[^,]*,/, '');
  if (!data) throw new Error('no frame');
  const ms = timeoutMs > 0 ? timeoutMs : config.timeouts.live;
  const started = Date.now();
  try {
    return await withDeadline(ms, 'gemini live', async (signal) => {
      const model = await modelFor(signal);
      const contents = [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: frame.mediaType || 'image/jpeg', data } },
            { text: userText(transcript, previousPrompt) },
          ],
        },
      ];
      return parseReply(await generate(model, contents, signal));
    });
  } catch (e) {
    warn(`gemini live failed after ${Date.now() - started}ms: ${e.message}`);
    if (e.status === 404 && !configuredModel()) settled = false; // the model is gone: pick again
    throw e;
  }
}
