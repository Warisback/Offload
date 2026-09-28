// Live filming prompts via OpenAI: the fastest small vision model on the key (benchmarked ~0.7-1.0 s for gpt-5.4-nano).
// Gemini is the fallback when this throws (flows.liveFrame). Structured output pins the prompt to the fixed list.
import { config, has } from './config.js';
import { PROMPTS } from './gemini.js';
import { clip, log, warn } from './util.js';

// Fastest first (measured on a 512px frame, detail "low", one-line JSON answer).
const PREFERRED = ['gpt-5.4-nano', 'gpt-5-nano', 'gpt-4o-mini', 'gpt-4.1-nano', 'gpt-5.4-mini', 'gpt-4.1-mini'];
const API = 'https://api.openai.com/v1';

let model = null;
let ready = null;

const headers = () => ({ Authorization: `Bearer ${config.openaiKey}`, 'content-type': 'application/json' });
const oneLine = (s) => clip(String(s || '').replace(/\s+/g, ' ').trim(), 160);

// gpt-5.1+ accept "none", gpt-5 needs "minimal"; older chat models take no reasoning knob.
function reasoning(m) {
  if (/^gpt-5\.\d/.test(m)) return { reasoning_effort: 'none' };
  if (/^gpt-5(-|$)/.test(m)) return { reasoning_effort: 'minimal' };
  return {};
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt', 'notes'],
  properties: { prompt: { type: 'string', enum: PROMPTS }, notes: { type: 'string' } },
};

const SYSTEM = `You coach someone filming a pile of clothes to sell. Each message is one video frame plus their last words.
Reply with ONE next prompt from the allowed list and a note of what you see (12 words max, plain, e.g. "grey hoodie, no brand visible yet").
New item and no label seen yet -> "Show me the label". Only one side seen -> "Turn it round". Wear not checked -> "Any marks or damage?".
Size unknown -> "Show the size tag". Bunched or folded -> "Hold it up flat".
Signature, writing, paint, patches or hand-made changes seen or mentioned -> "Show me the signature or the change up close".
Something unusual (no label, customised, one of a kind) -> "What would you want for this one?" or "Anything special about it?".
Item fully covered -> "Got it, next item". They say that's everything -> "Looks good, you can stop".
Don't repeat the previous prompt unless it's still clearly needed.`;

// Picks the model once (env override, else the fastest one the key can see) and warms it. Never throws.
export function init() {
  if (!has.openai()) return Promise.resolve(null);
  ready ||= (async () => {
    model = config.openaiModel || null;
    if (!model) {
      try {
        const r = await fetch(`${API}/models`, { headers: headers(), signal: AbortSignal.timeout(5000) });
        const j = await r.json();
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${oneLine(j?.error?.message)}`);
        const ids = new Set((j.data || []).map((m) => m.id));
        model = PREFERRED.find((m) => ids.has(m)) || 'gpt-4o-mini';
      } catch (e) {
        warn(`OpenAI model list failed (${e.message}), using ${PREFERRED[0]}`);
        model = PREFERRED[0];
      }
    }
    log(`Live prompts: OpenAI ${model} (Gemini fallback ${has.gemini() ? 'on' : 'off'})`);
    // Warm the connection so the first real frame is fast.
    fetch(`${API}/chat/completions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ model, max_completion_tokens: 16, ...reasoning(model), messages: [{ role: 'user', content: 'hi' }] }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});
    return model;
  })();
  return ready;
}

// frame: { data (base64 JPEG, ~512px), mediaType }. Throws on error or timeout; the caller falls back.
export async function livePrompt({ frame, transcript = '', previousPrompt = null, timeoutMs } = {}) {
  if (!has.openai()) throw new Error('not configured');
  if (!model) await init();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs ?? config.timeouts.live);
  try {
    const r = await fetch(`${API}/chat/completions`, {
      method: 'POST',
      headers: headers(),
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        max_completion_tokens: 120,
        ...reasoning(model),
        response_format: { type: 'json_schema', json_schema: { name: 'live_prompt', strict: true, schema: SCHEMA } },
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Previous prompt: ${previousPrompt || 'none'}\nLast words: "${String(transcript).slice(-300)}"` },
              { type: 'image_url', image_url: { url: `data:${frame.mediaType || 'image/jpeg'};base64,${frame.data}`, detail: 'low' } },
            ],
          },
        ],
      }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`openai ${r.status}: ${oneLine(j?.error?.message)}`);
    const out = JSON.parse(j?.choices?.[0]?.message?.content || 'null');
    const prompt = PROMPTS.find((p) => p.toLowerCase() === String(out?.prompt || '').trim().toLowerCase());
    if (!prompt) throw new Error('openai: prompt not in the fixed list');
    return { prompt, notes: clip(String(out.notes || '').replace(/\s+/g, ' ').trim(), 90) };
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('openai live: timed out');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Seller's voice (data URL or raw base64 from MediaRecorder: webm/opus, mp4/aac, ogg) -> text. Throws on failure.
export async function transcribe(audio, { timeoutMs = 12000 } = {}) {
  if (!has.openai()) throw new Error('not configured');
  const m = /^data:([^;,]+)[^,]*,/.exec(String(audio || ''));
  const mime = (m?.[1] || 'audio/webm').toLowerCase();
  const buf = Buffer.from(String(audio).slice(m ? m[0].length : 0), 'base64');
  if (buf.length < 1000) throw new Error('recording too short');
  const ext = mime.includes('mp4') || mime.includes('aac') || mime.includes('m4a') ? 'mp4' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), `voice.${ext}`);
  form.append('model', 'gpt-4o-mini-transcribe');
  form.append('language', 'en');
  const r = await fetch(`${API}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiKey}` },
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((e) => {
    throw new Error(e.name === 'TimeoutError' ? 'transcription timed out' : `transcription failed: ${e.message}`);
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`openai transcribe ${r.status}: ${oneLine(j?.error?.message)}`);
  return String(j?.text || '').trim();
}
