// The one API boundary. Real mode calls the backend; mock mode calls the in-browser mock (src/lib/mock.ts).
// A failed real request is an error, never a silent switch to mock data.
import { API_BASE, USE_MOCK } from './config';
import type { AppState, DemoStep, Item, Job, LiveFrameReply, Offer, Pence, Pickup } from '../types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type Method = 'GET' | 'POST';
type MockHandler = (method: Method, path: string, body: unknown) => Promise<unknown>;

let mockHandler: Promise<MockHandler> | null = null;
function mock(): Promise<MockHandler> {
  mockHandler ||= import('./mock').then((m) => m.handle as MockHandler);
  return mockHandler;
}

// Model-backed routes can take a while; everything else should be quick.
const SLOW = /^\/api\/(pickups$|items\/[^/]+\/photos$|pickups\/[^/]+\/handover$)/;

async function request<T>(method: Method, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  if (USE_MOCK) {
    try {
      return (await (await mock())(method, path, body)) as T;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(500, e instanceof Error ? e.message : 'Mock error');
    }
  }

  const ctrl = new AbortController();
  const timeoutMs = SLOW.test(path) ? 90_000 : path === '/api/live/frame' ? 6_000 : 15_000;
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  const onAbort = () => ctrl.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(API_BASE + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        'ngrok-skip-browser-warning': '1', // free ngrok serves an HTML warning page without this
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiError(res.status || 502, "The server sent something that isn't JSON. Is the API address right?");
    }
    if (!res.ok) {
      const msg = (json as { error?: string } | null)?.error || `Request failed (${res.status})`;
      throw new ApiError(res.status, msg);
    }
    return json as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (signal?.aborted) throw e; // caller cancelled; let them ignore it
    if (ctrl.signal.aborted) throw new ApiError(408, 'That took too long. Check your connection and try again.');
    throw new ApiError(0, typeof navigator !== 'undefined' && !navigator.onLine ? "You're offline." : "Can't reach offload right now.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const post = <T>(path: string, body: unknown = {}) => request<T>('POST', path, body);

export const api = {
  state: (signal?: AbortSignal) => request<AppState>('GET', '/api/state', undefined, signal),
  liveFrame: (frame_b64: string, transcript: string) => post<LiveFrameReply>('/api/live/frame', { frame_b64, transcript }),
  // audio_b64 (optional): the seller's voice recorded while filming; the server transcribes it when the browser couldn't.
  createPickup: (body: { seller_name: string; address: string; frames_b64: string[]; transcript: string; audio_b64?: string }) =>
    post<Pickup>('/api/pickups', body),
  book: (pickupId: string) => post<Job>(`/api/pickups/${pickupId}/book`),
  acceptJob: (jobId: string, runner_name: string) => post<Job>(`/api/jobs/${jobId}/accept`, { runner_name }),
  uploadPhotos: (itemId: string, photos_b64: string[]) => post<Item>(`/api/items/${itemId}/photos`, { photos_b64 }),
  setAsk: (itemId: string, seller_ask: Pence | null) => post<Item>(`/api/items/${itemId}/ask`, { seller_ask }),
  sendProof: (itemId: string, photos_b64: string[], note: string) => post<Item>(`/api/items/${itemId}/proof`, { photos_b64, note }),
  handover: (pickupId: string) => post<Pickup>(`/api/pickups/${pickupId}/handover`),
  makeOffer: (item_id: string, amount: Pence, buyer: string) => post<Offer>('/api/offers', { item_id, amount, buyer }),
  jobDone: (jobId: string) => post<Job>(`/api/jobs/${jobId}/done`),
  demo: (step: DemoStep) => post<{ ok: true }>(`/api/demo/${step}`),
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
