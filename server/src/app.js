// The Express app: exactly the contract routes, CORS for every origin, JSON errors.
import express from 'express';
import cors from 'cors';
import { find, publicItem, publicState } from './store.js';
import * as flows from './flows.js';
import { HttpError } from './flows.js';
import * as demo from './demo.js';
import { toPence, log, warn } from './util.js';

function need(kind, rowId, what) {
  const row = typeof rowId === 'string' ? find(kind, rowId) : null;
  if (!row) throw new HttpError(404, `No ${what} with id ${rowId}.`);
  return row;
}

const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.length > 0) : []);

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '80mb' }));
  app.use((req, _res, next) => {
    if (req.method === 'POST' && req.path !== '/api/live/frame') log(`${req.method} ${req.path}`);
    next();
  });

  // Polled every 1.5 s. Memory only: never a model, never the network.
  app.get('/api/state', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(publicState());
  });

  app.post('/api/live/frame', async (req, res) => {
    const { frame_b64, transcript } = req.body || {};
    res.json(await flows.liveFrame({ frame_b64, transcript }));
  });

  app.post('/api/pickups', async (req, res) => {
    const { seller_name, address, frames_b64, transcript, audio_b64 } = req.body || {};
    const frames = strings(frames_b64);
    const audio = typeof audio_b64 === 'string' && audio_b64.length > 100 ? audio_b64 : null; // optional voice recording
    if (!frames.length && !String(transcript || '').trim() && !audio) throw new HttpError(400, 'Send at least one frame or some transcript.');
    res.json(await flows.estimateFromVideo({ seller_name, address, frames_b64: frames, transcript, audio_b64: audio }));
  });

  app.post('/api/pickups/:id/book', (req, res) => {
    res.json(flows.book(need('pickups', req.params.id, 'pickup')));
  });

  app.post('/api/jobs/:id/accept', (req, res) => {
    res.json(flows.acceptJob(need('jobs', req.params.id, 'job'), req.body?.runner_name));
  });

  app.post('/api/items/:id/photos', async (req, res) => {
    const item = need('items', req.params.id, 'item');
    const photos = strings(req.body?.photos_b64);
    if (!photos.length) throw new HttpError(400, 'Send at least one photo in photos_b64.');
    if (['listed', 'offer', 'sold', 'posted'].includes(item.status)) throw new HttpError(409, 'This one is already listed.');
    await flows.photographItem(item, photos);
    res.json(publicItem(item));
  });

  app.post('/api/items/:id/ask', async (req, res) => {
    const item = need('items', req.params.id, 'item');
    const raw = req.body?.seller_ask;
    const ask = raw === null || raw === undefined || raw === '' ? null : toPence(raw);
    if (raw != null && raw !== '' && !ask) throw new HttpError(400, 'seller_ask must be a whole number of pence, or null to clear it.');
    if (['sold', 'posted'].includes(item.status)) throw new HttpError(409, "It's already sold.");
    await flows.setAsk(item, ask);
    res.json(publicItem(item));
  });

  app.post('/api/items/:id/proof', async (req, res) => {
    const item = need('items', req.params.id, 'item');
    const photos = strings(req.body?.photos_b64);
    const note = typeof req.body?.note === 'string' ? req.body.note : '';
    if (!photos.length && !note.trim()) throw new HttpError(400, 'Send a photo or a note.');
    await flows.addProof(item, photos, note);
    res.json(publicItem(item));
  });

  app.post('/api/pickups/:id/handover', async (req, res) => {
    res.json(await flows.handover(need('pickups', req.params.id, 'pickup')));
  });

  app.post('/api/offers', async (req, res) => {
    const { item_id, amount, buyer } = req.body || {};
    const item = need('items', item_id, 'item');
    const pence = toPence(amount);
    if (!pence) throw new HttpError(400, 'amount must be a whole number of pence.');
    if (!['listed', 'offer', 'sold', 'posted'].includes(item.status)) throw new HttpError(409, "This one isn't listed yet.");
    res.json(await flows.makeOffer({ item, amount: pence, buyer }));
  });

  app.post('/api/jobs/:id/done', (req, res) => {
    res.json(flows.jobDone(need('jobs', req.params.id, 'job')));
  });

  app.post('/api/demo/:step', async (req, res) => {
    await demo.runStep(req.params.step);
    res.json({ ok: true });
  });

  app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) warn(`${req.method} ${req.path} failed:`, err.stack || err.message);
    let message = err.message;
    if (status === 413) message = 'That upload is too big. Try fewer or smaller photos.';
    else if (err.type === 'entity.parse.failed') message = "That request body isn't valid JSON.";
    else if (status >= 500) message = 'Something went wrong on our side. Try again.';
    res.status(status).json({ error: message });
  });

  return app;
}
