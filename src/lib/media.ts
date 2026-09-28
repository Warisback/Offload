// Camera and speech helpers for filming a pile. Everything degrades gracefully:
// no camera -> CameraError with a reason the UI can explain; no speech API -> createRecognizer returns null.

// ---------- camera ----------

export type CameraFailure = 'denied' | 'unavailable' | 'insecure' | 'busy';

export class CameraError extends Error {
  reason: CameraFailure;
  constructor(reason: CameraFailure, message: string) {
    super(message);
    this.name = 'CameraError';
    this.reason = reason;
  }
}

export const cameraSupported = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';

const MIC: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

// Camera AND mic in one permission prompt: the mic is recorded while filming and transcribed on the server,
// so it works in every browser (the Web Speech API only works in Google Chrome, and never asks for the mic
// itself in Brave/Arc/Edge/Firefox). If the mic is refused or missing, filming carries on with the camera alone.
export async function startCamera(facing: 'environment' | 'user' = 'environment'): Promise<MediaStream> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new CameraError('insecure', 'The camera only works over https.');
  }
  if (!cameraSupported()) throw new CameraError('unavailable', "This browser can't open a camera.");
  const video: MediaTrackConstraints = { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } };
  // Some laptops reject the size hints (OverconstrainedError), so each step has a plain `video: true` twin.
  const attempts: [MediaTrackConstraints | true, MediaTrackConstraints | false][] = [
    [video, MIC],
    [true, MIC],
    [video, false],
    [true, false],
  ];
  let last: unknown = null;
  let noMic = false; // once the mic fails, don't ask for it again (each retry can re-prompt, and 3 dismissals block the camera)
  for (const [v, a] of attempts) {
    if (a && noMic) continue;
    try {
      return await navigator.mediaDevices.getUserMedia({ video: v, audio: a });
    } catch (e) {
      last = e;
      const name = (e as { name?: string })?.name || '';
      if (name === 'OverconstrainedError') continue;
      if (a && ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'SecurityError', 'AbortError'].includes(name)) {
        noMic = true; // mic trouble: try camera only
        continue;
      }
      throw toCameraError(e);
    }
  }
  throw toCameraError(last);
}

export const hasMic = (stream: MediaStream | null | undefined) => Boolean(stream?.getAudioTracks().some((t) => t.readyState === 'live'));

// ---------- voice recording (transcribed on the server when filming stops) ----------

export interface VoiceRecorder {
  // Stops and resolves with a data URL of the recording, or null if nothing was captured.
  stop(): Promise<string | null>;
  abort(): void;
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

export function startVoiceRecorder(stream: MediaStream | null | undefined): VoiceRecorder | null {
  const tracks = stream?.getAudioTracks().filter((t) => t.readyState === 'live') || [];
  if (!tracks.length || typeof MediaRecorder === 'undefined') return null;
  // Chrome/Firefox record webm/opus, Safari records mp4/aac; the server accepts both.
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(new MediaStream(tracks), mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined);
  } catch {
    return null;
  }
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  try {
    rec.start(1000);
  } catch {
    return null;
  }
  let result: Promise<string | null> | null = null;
  return {
    stop() {
      result ||= new Promise((resolve) => {
        let done = false;
        const finish = async () => {
          if (done) return;
          done = true;
          const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' });
          resolve(blob.size > 1000 ? await blobToDataUrl(blob).catch(() => null) : null);
        };
        if (rec.state === 'inactive') return void finish();
        rec.onstop = () => void finish();
        try {
          rec.stop();
        } catch {
          void finish();
        }
        setTimeout(() => void finish(), 2000); // never hang the estimate on a recorder that won't stop
      });
      return result;
    },
    abort() {
      rec.ondataavailable = null;
      rec.onstop = null;
      try {
        if (rec.state !== 'inactive') rec.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

function toCameraError(e: unknown): CameraError {
  const name = (e as { name?: string })?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return new CameraError('denied', 'Camera access is blocked.');
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return new CameraError('busy', 'Another app is using the camera.');
  }
  return new CameraError('unavailable', "Couldn't find a camera.");
}

// Plays a stream in a <video>. iOS needs muted + playsInline, which the element sets too.
export async function attachStream(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    /* autoplay can reject before metadata; the autoPlay attribute retries */
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      /* already stopped */
    }
  });
}

// Laptop webcams face the user: mirror the preview (never the frames we send).
export function isFrontFacing(stream: MediaStream | null | undefined): boolean {
  const track = stream?.getVideoTracks()[0];
  const facing = track?.getSettings?.().facingMode;
  if (facing) return facing === 'user';
  return !/Android|iPhone|iPad|iPod/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
}

// ---------- speech ----------

// Minimal Web Speech API types (not in TypeScript's DOM lib).
interface SRAlternative {
  transcript: string;
}
interface SRResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SRAlternative;
}
interface SREvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: SRResult };
}
interface SRErrorEvent {
  readonly error: string;
}
interface SR {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRCtor = new () => SR;

function speechCtor(): SRCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export const speechSupported = () => speechCtor() !== null;

export interface Recognizer {
  start(): void;
  // Stops listening and resolves with everything heard (including the last half-heard words).
  finish(timeoutMs?: number): Promise<string>;
  // Stops immediately, no waiting. Safe to call more than once.
  abort(): void;
  text(): string;
}

export interface RecognizerOptions {
  lang?: string;
  onUpdate: (finalText: string, interim: string) => void;
  // fatal = listening has stopped for good (mic blocked, or the service keeps failing).
  onError?: (code: string, fatal: boolean) => void;
}

const join = (...parts: string[]) => parts.map((p) => p.trim()).filter(Boolean).join(' ');

// Android Chrome sometimes repeats earlier words inside later final results ("hello", "hello there").
function pushFinal(list: string[], text: string): string[] {
  const t = text.trim();
  if (!t) return list;
  const prev = list.at(-1);
  if (prev && t.toLowerCase().startsWith(prev.toLowerCase())) return [...list.slice(0, -1), t];
  return [...list, t];
}

// Continuous en-GB recognition that restarts itself when the browser ends a session, until stopped.
export function createRecognizer({ lang = 'en-GB', onUpdate, onError }: RecognizerOptions): Recognizer | null {
  const Ctor = speechCtor();
  if (!Ctor) return null;

  let rec: SR;
  try {
    rec = new Ctor();
  } catch {
    return null;
  }
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let active = false; // we want to be listening
  let running = false; // the browser session is live
  let committed = ''; // text from sessions that already ended
  let sessionFinal = '';
  let interim = '';
  let lastStart = 0;
  let quickEnds = 0;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let endWaiters: (() => void)[] = [];

  const full = () => join(committed, sessionFinal);

  const begin = () => {
    try {
      lastStart = Date.now();
      rec.start();
      running = true;
    } catch {
      /* already started */
    }
  };

  rec.onresult = (e) => {
    let finals: string[] = [];
    let live = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      const t = r?.[0]?.transcript ?? '';
      if (r?.isFinal) finals = pushFinal(finals, t);
      else live += ` ${t}`;
    }
    sessionFinal = finals.join(' ');
    interim = live.trim();
    onUpdate(full(), interim);
  };

  rec.onerror = (e) => {
    const code = e?.error || 'unknown';
    if (code === 'no-speech' || code === 'aborted') return; // normal pauses
    const fatal = code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture';
    if (fatal) active = false;
    onError?.(code, fatal);
  };

  rec.onend = () => {
    running = false;
    // Words still half-heard when a session ends will never be finalised: keep them.
    committed = join(committed, sessionFinal, interim);
    sessionFinal = '';
    interim = '';
    const waiters = endWaiters;
    endWaiters = [];
    waiters.forEach((w) => w());
    if (!active) return;
    // Guard against a tight restart loop (offline, service down).
    quickEnds = Date.now() - lastStart < 1500 ? quickEnds + 1 : 0;
    if (quickEnds > 4) {
      active = false;
      onError?.('restart-loop', true);
      return;
    }
    restartTimer = setTimeout(() => active && begin(), quickEnds ? 350 : 0);
  };

  return {
    start() {
      if (active) return;
      active = true;
      quickEnds = 0;
      begin();
    },
    finish(timeoutMs = 900) {
      active = false;
      clearTimeout(restartTimer);
      const heard = () => join(full(), interim);
      if (!running) return Promise.resolve(heard());
      return new Promise<string>((resolve) => {
        const done = () => {
          clearTimeout(t);
          resolve(heard());
        };
        const t = setTimeout(() => {
          endWaiters = endWaiters.filter((w) => w !== done);
          try {
            rec.abort();
          } catch {
            /* ignore */
          }
          resolve(heard());
        }, timeoutMs);
        endWaiters.push(done);
        try {
          rec.stop();
        } catch {
          done();
        }
      });
    },
    abort() {
      active = false;
      clearTimeout(restartTimer);
      endWaiters = [];
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
      running = false;
    },
    text: () => join(full(), interim),
  };
}
