// The camera surface: live video, a floating prompt bubble that springs between prompts, a live caption,
// the record button and every overlay state. Phone = full screen (portal), desktop = panel + side content.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Mic, MicOff, Sparkles, X } from 'lucide-react';
import { EASE, SPRING } from '../../components/motion';
import type { Pickup } from '../../types';
import { CameraBlocked, FilmError, Opening, PhotosPanel, StorySheet, Thinking } from './FilmOverlays';
import { STOP_PROMPT, useFilming, type FilmDetails, type Filming } from './useFilming';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function PromptBubble({ prompt }: { prompt: string }) {
  return (
    <div className="sl-prompt-wrap" aria-live="polite">
      <AnimatePresence mode="popLayout">
        <motion.div
          key={prompt}
          className="sl-prompt"
          initial={{ opacity: 0, y: -18, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
        >
          <span className="sl-prompt-icon">
            <Sparkles size={18} aria-hidden />
          </span>
          <span>{prompt}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Caption({ f }: { f: Filming }) {
  let body: ReactNode;
  const captions = f.speech === 'listening' || f.speech === 'idle';
  if (!captions && f.mic) body = <span className="sl-caption-dim">Recording your voice. I'll write it up when you stop.</span>;
  else if (f.speech === 'blocked') body = <span className="sl-caption-dim">Can't hear you. You can type it when you stop.</span>;
  else if (f.speech === 'unsupported') body = <span className="sl-caption-dim">This browser can't listen along. You can type it after.</span>;
  else if (!f.heard && !f.interim) body = <span className="sl-caption-dim">{f.mic ? 'Recording your voice… say what each piece is' : 'Listening… say what each piece is'}</span>;
  else {
    const all = `${f.heard} ${f.interim}`.trim();
    const cut = all.length > 96;
    const tail = cut ? all.slice(-96) : all;
    const split = Math.max(0, tail.length - f.interim.length);
    body = (
      <span>
        {cut ? '…' : ''}
        {tail.slice(0, split)}
        <span className="sl-caption-dim">{tail.slice(split)}</span>
      </span>
    );
  }
  const deaf = (f.speech === 'blocked' || f.speech === 'unsupported') && !f.mic;
  const MicIcon = deaf ? MicOff : Mic;
  return (
    <motion.p className="sl-caption" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.3, ease: EASE }}>
      <MicIcon size={15} aria-hidden className={f.speech === 'listening' || (!deaf && f.mic) ? 'sl-mic-live' : ''} />
      {body}
    </motion.p>
  );
}

function RecordButton({ f, onPress, nudge }: { f: Filming; onPress: () => void; nudge: boolean }) {
  const recording = f.phase === 'recording';
  return (
    <motion.button
      type="button"
      className={`sl-rec ${recording ? 'is-recording' : ''} ${nudge ? 'is-nudge' : ''}`}
      aria-label={recording ? 'Stop recording' : 'Start recording'}
      disabled={f.cam !== 'on'}
      onClick={onPress}
      whileTap={{ scale: 0.9 }}
      transition={SPRING}
    >
      <span className="sl-rec-core" />
    </motion.button>
  );
}

function RecentShots({ f }: { f: Filming }) {
  return (
    <div className="sl-shots">
      <div className="sl-shots-stack" aria-hidden>
        <AnimatePresence initial={false}>
          {f.recent.map((r, i) => (
            <motion.img
              key={r.id}
              src={r.src}
              alt=""
              initial={{ opacity: 0, scale: 0.4, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0, rotate: (i - f.recent.length + 1) * 7 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={SPRING}
            />
          ))}
        </AnimatePresence>
      </div>
      {f.shots ? <small>{f.shots} shots</small> : null}
    </div>
  );
}

export interface FilmProps {
  layout: 'phone' | 'desktop';
  details: FilmDetails;
  canRecord?: boolean;
  onBlocked?: () => void;
  onClose: () => void;
  onDone: (p: Pickup) => void;
  // Desktop only: what sits beside the camera. Gets the filming state so it can lock fields mid-recording.
  aside?: (f: Filming) => ReactNode;
}

export function Film({ layout, details, canRecord = true, onBlocked, onClose, onDone, aside }: FilmProps) {
  const f = useFilming(details, onDone, { ready: canRecord, onBlocked });
  const live = f.phase === 'ready' || f.phase === 'recording';
  const camFailed = f.cam !== 'on' && f.cam !== 'starting';
  const recording = f.phase === 'recording';
  const nudge = recording && f.prompt === STOP_PROMPT;

  const press = () => {
    if (recording) f.stop();
    else if (!canRecord) onBlocked?.();
    else f.start();
  };

  // Phone: lock the page behind the full-screen camera and move focus into it.
  const screen = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (layout !== 'phone') return;
    const prev = document.body.style.overflow;
    const back = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    screen.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prev;
      back?.focus?.({ preventScroll: true });
    };
  }, [layout]);

  // Escape closes the camera unless we're mid-send.
  const busy = f.phase === 'thinking';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  let overlay: ReactNode = null;
  if (f.phase === 'thinking') overlay = <Thinking key="think" frames={f.sending} photos={f.source === 'photos'} />;
  else if (f.phase === 'error') overlay = <FilmError key="error" f={f} />;
  else if (f.phase === 'story') overlay = <StorySheet key="story" f={f} />;
  else if (f.phase === 'photos') overlay = <PhotosPanel key="photos" f={f} cameraOk={f.cam !== 'unavailable' && f.cam !== 'insecure'} />;
  else if (camFailed) overlay = <CameraBlocked key="blocked" reason={f.cam as Exclude<typeof f.cam, 'on' | 'starting'>} f={f} />;
  else if (f.cam === 'starting') overlay = <Opening key="opening" />;

  const surface = (
    <div className={`sl-cam ${layout === 'phone' ? 'is-phone' : 'is-desk'} ${recording ? 'is-recording' : ''}`}>
      <video ref={f.videoRef} className={`sl-cam-video ${f.mirror ? 'is-mirror' : ''}`} playsInline muted autoPlay aria-hidden />
      <div className="sl-cam-shade" aria-hidden />

      <div className="sl-cam-top">
        {f.phase !== 'thinking' ? (
          <button className="round-button sl-close" aria-label="Close the camera" onClick={onClose}>
            <X size={20} aria-hidden />
          </button>
        ) : (
          <span className="sl-close-gap" />
        )}
        <AnimatePresence mode="wait" initial={false}>
          {recording ? (
            <motion.span key="rec" className="sl-rec-pill" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={SPRING}>
              <i aria-hidden /> REC <time aria-label={`${f.elapsed} seconds`}>{clock(f.elapsed)}</time>
            </motion.span>
          ) : (
            <motion.span key="label" className="sl-cam-label" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {f.phase === 'thinking' ? 'ONE MOMENT' : 'YOUR PILE'}
            </motion.span>
          )}
        </AnimatePresence>
        <span className="sl-close-gap" />
      </div>

      {live && f.cam === 'on' ? <PromptBubble prompt={f.prompt} /> : null}
      {live && f.cam === 'on' ? <div className={`sl-scan ${recording ? 'is-live' : ''}`} aria-hidden><i /><i /><i /><i /></div> : null}

      {live && f.cam === 'on' ? (
        <div className="sl-cam-bottom">
          <AnimatePresence>{recording ? <Caption key="cap" f={f} /> : null}</AnimatePresence>
          <div className="sl-cam-controls">
            <RecentShots f={f} />
            <RecordButton f={f} onPress={press} nudge={nudge} />
            <span className="sl-shots-gap" />
          </div>
          <small className="sl-cam-hint" aria-live="polite">
            {nudge ? "That's plenty. Tap to finish" : recording ? "Tap when you're done" : canRecord ? 'Tap to start, then talk us through each piece' : 'Add your details, then tap to start'}
          </small>
        </div>
      ) : null}

      <AnimatePresence mode="wait">{overlay}</AnimatePresence>
    </div>
  );

  if (layout === 'phone') {
    return createPortal(
      <motion.div
        ref={screen}
        tabIndex={-1}
        className="sl-film-screen"
        role="dialog"
        aria-modal="true"
        aria-label="Film your pile"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ duration: 0.45, ease: EASE }}
      >
        {surface}
      </motion.div>,
      document.body,
    );
  }

  return (
    <motion.div className="capture-layout sl-capture" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
      {surface}
      <div className="panel capture-explain sl-capture-aside">{aside?.(f)}</div>
    </motion.div>
  );
}
