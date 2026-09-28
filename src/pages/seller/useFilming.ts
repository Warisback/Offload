// Filming a pile: camera, live captions, a frame every ~2.5 s sent to /api/live/frame for the next prompt,
// then all frames (sampled to 16) + transcript to POST /api/pickups. Tracks and recognition are always
// stopped on stop and on unmount.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../lib/api';
import { fileToDataUrl, sampleEvenly, videoFrame } from '../../lib/images';
import {
  CameraError,
  attachStream,
  createRecognizer,
  hasMic,
  isFrontFacing,
  speechSupported,
  startCamera,
  startVoiceRecorder,
  stopStream,
  type CameraFailure,
  type Recognizer,
  type VoiceRecorder,
} from '../../lib/media';
import type { Pickup } from '../../types';

export type FilmPhase = 'ready' | 'recording' | 'story' | 'thinking' | 'error' | 'photos';
export type CamStatus = 'starting' | 'on' | CameraFailure;
export type SpeechStatus = 'idle' | 'listening' | 'unsupported' | 'blocked';
// empty = we sent it but nothing was spotted; send = the request failed; nothing = nothing to send;
// details = the address is missing (desktop, where the form sits beside the camera).
export type FilmFailure = { kind: 'empty' | 'send' | 'nothing' | 'details'; source: 'video' | 'photos'; message?: string };

export const READY_PROMPT = 'Every piece has a story. Tell us yours.';
export const FIRST_PROMPT = 'Hold each piece up and tell me about it';
export const STOP_PROMPT = 'Looks good, you can stop';

const FRAME_MS = 2500;
const MAX_FRAMES = 120; // ~5 minutes; older frames are thinned, never dropped wholesale
const MAX_PHOTOS = 24;

const join = (...parts: string[]) => parts.map((p) => p.trim()).filter(Boolean).join(' ');

export interface FilmDetails {
  name: string;
  address: string;
  story: string;
}

export interface FilmGuard {
  ready: boolean; // details are good enough to send (the address is required by POST /api/pickups)
  onBlocked?: () => void; // show the seller what's missing
}

export function useFilming(details: FilmDetails, onDone: (p: Pickup) => void, guard: FilmGuard = { ready: true }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<FilmPhase>('ready');
  const [cam, setCam] = useState<CamStatus>('starting');
  const [camAttempt, setCamAttempt] = useState(0);
  const [mirror, setMirror] = useState(false);
  const [speech, setSpeechState] = useState<SpeechStatus>(() => (speechSupported() ? 'idle' : 'unsupported'));
  const [mic, setMic] = useState(false); // the camera stream carries a live mic track (recorded, transcribed on the server)
  const [heard, setHeard] = useState('');
  const [interim, setInterim] = useState('');
  const [prompt, setPrompt] = useState<string>(READY_PROMPT);
  const [elapsed, setElapsed] = useState(0);
  const [shots, setShots] = useState(0);
  const [recent, setRecent] = useState<{ id: number; src: string }[]>([]);
  const [sending, setSending] = useState<string[]>([]);
  const [photos, setPhotos] = useState<{ id: number; src: string }[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [failure, setFailure] = useState<FilmFailure | null>(null);
  const [source, setSource] = useState<FilmFailure['source']>('video'); // what the current estimate is from

  const frames = useRef<string[]>([]);
  const shotId = useRef(0);
  const recognizer = useRef<Recognizer | null>(null);
  const voice = useRef<VoiceRecorder | null>(null);
  const transcript = useRef('');
  const liveBusy = useRef(false);
  const recording = useRef(false);
  const mounted = useRef(true);
  const speechRef = useRef(speech);
  const payload = useRef<{ frames: string[]; transcript: string; source: FilmFailure['source']; audio: string | null } | null>(null);
  const inflight = useRef(false);
  const detailsRef = useRef(details);
  const onDoneRef = useRef(onDone);
  const guardRef = useRef(guard);
  const photosRef = useRef(photos);
  useEffect(() => {
    detailsRef.current = details;
    onDoneRef.current = onDone;
    guardRef.current = guard;
    photosRef.current = photos;
  });

  const setSpeech = useCallback((s: SpeechStatus) => {
    speechRef.current = s;
    setSpeechState(s);
  }, []);

  // Unmount: stop listening and ignore any late replies. (The camera effect stops the tracks.)
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recording.current = false;
      recognizer.current?.abort();
      recognizer.current = null;
      voice.current?.abort();
      voice.current = null;
    };
  }, []);

  // The camera is only on while it's needed: ready or recording.
  const needCamera = phase === 'ready' || phase === 'recording';
  useEffect(() => {
    if (!needCamera) return;
    let cancelled = false;
    setCam('starting');
    startCamera('environment')
      .then(async (stream) => {
        if (cancelled) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        setMic(hasMic(stream));
        setMirror(isFrontFacing(stream));
        stream.getVideoTracks()[0]?.addEventListener('ended', () => !cancelled && setCam('busy'));
        const v = videoRef.current;
        if (v) await attachStream(v, stream);
        if (!cancelled) setCam('on');
      })
      .catch((e) => {
        if (!cancelled) setCam(e instanceof CameraError ? e.reason : 'unavailable');
      });
    return () => {
      cancelled = true;
      stopStream(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [needCamera, camAttempt]);

  // One frame: keep it, and ask for the next prompt if no request is in flight (not for the final frame).
  const grab = useCallback((askForPrompt = true) => {
    const v = videoRef.current;
    if (!v || !recording.current) return;
    let f: string | null = null;
    try {
      f = videoFrame(v, 720);
    } catch {
      f = null;
    }
    if (!f) return;
    const frame = f;
    frames.current.push(frame);
    if (frames.current.length > MAX_FRAMES) frames.current = frames.current.filter((_, i) => i % 2 === 0);
    const id = ++shotId.current;
    setShots(id);
    setRecent((r) => [...r.slice(-2), { id, src: frame }]);
    if (!askForPrompt || liveBusy.current) return;
    liveBusy.current = true;
    api
      .liveFrame(frame, transcript.current.slice(-300))
      .then((r) => {
        if (recording.current && mounted.current && r?.prompt) setPrompt(r.prompt);
      })
      .catch(() => {
        /* keep the last prompt; filming never stops for this */
      })
      .finally(() => {
        liveBusy.current = false;
      });
  }, []);

  useEffect(() => {
    if (phase !== 'recording') return;
    const began = Date.now();
    const clock = setInterval(() => setElapsed(Math.floor((Date.now() - began) / 1000)), 250);
    const first = setTimeout(() => grab(), 700);
    const every = setInterval(() => grab(), FRAME_MS);
    return () => {
      clearInterval(clock);
      clearTimeout(first);
      clearInterval(every);
    };
  }, [phase, grab]);

  const send = useCallback(async (all: string[], text: string, source: FilmFailure['source'], audio: string | null = null) => {
    if (inflight.current) return; // one estimate at a time, however fast the taps
    const picked = sampleEvenly(all, 16);
    if (!picked.length && !text.trim() && !audio) {
      setFailure({ kind: 'nothing', source });
      setPhase('error');
      return;
    }
    payload.current = { frames: picked, transcript: text, source, audio };
    if (!guardRef.current.ready) {
      guardRef.current.onBlocked?.();
      setFailure({ kind: 'details', source });
      setPhase('error');
      return;
    }
    inflight.current = true;
    setSource(source);
    setSending(picked);
    setFailure(null);
    setPhase('thinking');
    const { name, address } = detailsRef.current;
    try {
      const p = await api.createPickup({
        seller_name: name.trim(),
        address: address.trim(),
        frames_b64: picked,
        transcript: text,
        ...(audio ? { audio_b64: audio } : {}),
      });
      if (!mounted.current) return;
      if (!p || !Array.isArray(p.preview) || p.preview.length === 0) {
        setFailure({ kind: 'empty', source });
        setPhase('error');
        return;
      }
      onDoneRef.current(p);
    } catch (e) {
      if (!mounted.current) return;
      setFailure({ kind: 'send', source, message: errorMessage(e) });
      setPhase('error');
    } finally {
      inflight.current = false;
    }
  }, []);

  const start = useCallback(() => {
    if (cam !== 'on' || recording.current) return;
    frames.current = [];
    shotId.current = 0;
    transcript.current = '';
    setShots(0);
    setRecent([]);
    setHeard('');
    setInterim('');
    setElapsed(0);
    setPrompt(FIRST_PROMPT);
    setFailure(null);
    recording.current = true;
    setPhase('recording');
    voice.current?.abort();
    voice.current = startVoiceRecorder(streamRef.current); // works in every browser; live captions below are a bonus
    if (speechRef.current === 'unsupported') return;
    // Phones: live captions fight the recorder for the mic (Android feeds them silence, iOS asks a second permission
    // and can cut the recording), so rely on the recording alone, transcribed when filming stops.
    if (voice.current && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      setSpeech('unsupported');
      return;
    }
    const r = createRecognizer({
      lang: 'en-GB',
      onUpdate: (finalText, live) => {
        transcript.current = join(finalText, live);
        if (!mounted.current) return;
        setHeard(finalText);
        setInterim(live);
      },
      onError: (_code, fatal) => {
        if (fatal && mounted.current) setSpeech('blocked');
      },
    });
    recognizer.current = r;
    if (r) {
      r.start();
      setSpeech('listening');
    } else setSpeech('unsupported');
  }, [cam, setSpeech]);

  const stop = useCallback(async () => {
    if (!recording.current) return;
    grab(false); // the last frame, while still recording
    recording.current = false;
    setPhase('thinking');
    setSending(sampleEvenly(frames.current, 16));
    const r = recognizer.current;
    recognizer.current = null;
    const v = voice.current;
    voice.current = null;
    const recorded = v ? v.stop() : Promise.resolve(null);
    const said = r ? await r.finish() : '';
    const audio = await recorded;
    if (!mounted.current) return;
    if (speechRef.current === 'listening') setSpeech('idle');
    setHeard(said);
    setInterim('');
    const typed = detailsRef.current.story.trim();
    const deaf = speechRef.current === 'blocked' || speechRef.current === 'unsupported';
    // The browser's own captions caught little or nothing: let the server transcribe the recording instead.
    const voiceNote = said.length < 20 ? audio : null;
    if (!said && !typed && deaf && !voiceNote) {
      setPhase('story'); // ask them to type what they'd have said
      return;
    }
    send(frames.current.slice(), join(said, typed), 'video', voiceNote);
  }, [grab, send, setSpeech]);

  // If the camera dies mid-recording, finish with what we have.
  useEffect(() => {
    if (phase === 'recording' && cam !== 'on' && cam !== 'starting') stop();
  }, [phase, cam, stop]);

  const submitStory = useCallback(
    (text: string) => send(frames.current.slice(), join(heard, detailsRef.current.story, text), 'video'),
    [send, heard],
  );

  const retrySend = useCallback(() => {
    if (payload.current) send(payload.current.frames, payload.current.transcript, payload.current.source, payload.current.audio);
  }, [send]);

  const filmAgain = useCallback(() => {
    frames.current = [];
    payload.current = null;
    setFailure(null);
    setPrompt(READY_PROMPT);
    setRecent([]);
    setShots(0);
    setPhase('ready');
  }, []);

  const retryCamera = useCallback(() => {
    setFailure(null);
    setPrompt(READY_PROMPT);
    setPhase('ready');
    setCamAttempt((a) => a + 1);
  }, []);

  // Camera fallback: photos from the library become the frames. `replace` starts a fresh set
  // ("Try different photos" after we couldn't spot anything in the last lot).
  const addPhotos = useCallback(async (files: FileList | File[] | null, replace = false) => {
    const all = Array.from(files || []);
    const list = all.filter((f) => !f.type || f.type.startsWith('image/'));
    setPhotoError(null);
    setFailure(null);
    setPhase('photos');
    if (replace) setPhotos([]);
    if (!list.length) {
      if (all.length) setPhotoError("Those don't look like photos. Try JPEG or PNG images.");
      return;
    }
    setPreparing(true);
    const out: string[] = [];
    for (const file of list) {
      try {
        out.push(await fileToDataUrl(file, 1024));
      } catch {
        /* counted below */
      }
    }
    if (!mounted.current) return;
    const skipped = list.length - out.length;
    const room = Math.max(0, MAX_PHOTOS - (replace ? 0 : photosRef.current.length));
    const fresh = out.map((src) => ({ id: ++shotId.current, src }));
    setPhotos((prev) => [...(replace ? [] : prev), ...fresh].slice(0, MAX_PHOTOS));
    setPreparing(false);
    if (skipped) setPhotoError(skipped === list.length ? "Couldn't read those photos. Try JPEG or PNG." : `Couldn't read ${skipped === 1 ? 'one' : skipped} of those. The rest are in.`);
    else if (out.length > room) setPhotoError(`That's plenty: we keep up to ${MAX_PHOTOS} photos.`);
  }, []);

  const removePhoto = useCallback((id: number) => setPhotos((p) => p.filter((x) => x.id !== id)), []);

  const sendPhotos = useCallback(
    (text: string) => send(photos.map((p) => p.src), join(detailsRef.current.story, text), 'photos'),
    [photos, send],
  );

  const openPhotos = useCallback(() => setPhase('photos'), []);

  return {
    videoRef,
    phase,
    cam,
    mirror,
    speech,
    mic,
    heard,
    interim,
    prompt,
    elapsed,
    shots,
    recent,
    sending,
    photos,
    preparing,
    photoError,
    failure,
    source,
    start,
    stop,
    submitStory,
    retrySend,
    filmAgain,
    retryCamera,
    addPhotos,
    removePhoto,
    sendPhotos,
    openPhotos,
  };
}

export type Filming = ReturnType<typeof useFilming>;
