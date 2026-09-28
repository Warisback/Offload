// Turns base64 (raw or data URL) into a resized JPEG buffer for models and storage.
import { warn } from './util.js';

let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch (e) {
  warn('sharp not available, images pass through unresized:', e.message);
}

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return null;
}

// Accepts "data:image/png;base64,...", raw base64, or a Buffer.
export function decodeB64(input) {
  if (Buffer.isBuffer(input)) return { buffer: input, mediaType: sniff(input) || 'image/jpeg' };
  if (typeof input !== 'string' || !input) throw new Error('empty image');
  let data = input;
  let declared = null;
  const m = /^data:([^;,]+)?(;base64)?,/.exec(input);
  if (m) {
    declared = m[1] || null;
    data = input.slice(m[0].length);
  }
  const buffer = Buffer.from(data.replace(/\s+/g, ''), 'base64');
  if (!buffer.length) throw new Error('image did not decode');
  return { buffer, mediaType: sniff(buffer) || declared || 'image/jpeg' };
}

// Returns { buffer, data (base64, no prefix), mediaType }.
// maxEdge 1568 suits Claude; the live Gemini frames use ~768 for speed.
export async function prepareImage(input, { maxEdge = 1568, quality = 80 } = {}) {
  const { buffer, mediaType } = decodeB64(input);
  if (sharp) {
    try {
      const out = await sharp(buffer, { failOn: 'none' })
        .rotate()
        .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      return { buffer: out, data: out.toString('base64'), mediaType: 'image/jpeg' };
    } catch (e) {
      warn('image resize failed, passing through:', e.message);
    }
  }
  return { buffer, data: buffer.toString('base64'), mediaType };
}

// Evenly samples up to n entries, keeping first and last.
export function sample(list, n) {
  if (!Array.isArray(list) || list.length <= n) return list || [];
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]);
  return out;
}
