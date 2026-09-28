// Everything that can sit over the camera: opening, blocked, photos instead, "we couldn't hear you",
// thinking (frames flicking past) and errors.
import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Camera, ImagePlus, Loader2, MapPin, MicOff, RotateCcw, ScanLine, Send, Sun, VideoOff, X } from 'lucide-react';
import { EASE, SPRING } from '../../components/motion';
import type { CameraFailure } from '../../lib/media';
import type { Filming } from './useFilming';

function Over({ children, className = '', label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <motion.div
      className={`sl-over ${className}`}
      role="group"
      aria-label={label}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

// A styled label around a hidden multi-image input (keyboard users land on the input itself).
export function PickPhotos({
  onFiles,
  children,
  variant = 'light',
  capture = false,
  disabled = false,
}: {
  onFiles: (files: File[]) => void;
  children: ReactNode;
  variant?: 'light' | 'dark' | 'outline';
  capture?: boolean;
  disabled?: boolean;
}) {
  return (
    <motion.label
      className={`button ${variant === 'dark' ? '' : variant} sl-pick ${disabled ? 'is-disabled' : ''}`}
      whileHover={disabled ? undefined : { y: -2 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={SPRING}
    >
      <ImagePlus size={18} aria-hidden />
      {children}
      <input
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        disabled={disabled}
        {...(capture ? { capture: 'environment' as const } : {})}
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files || []);
          e.currentTarget.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </motion.label>
  );
}

export function Opening() {
  return (
    <Over label="Opening the camera" className="is-soft">
      <Loader2 className="spin" size={26} aria-hidden />
      <p role="status">Opening your camera…</p>
    </Over>
  );
}

const BLOCKED: Record<CameraFailure, { title: string; body: string; retry: boolean }> = {
  denied: { title: "Your camera's blocked", body: 'Allow camera access for this site in your browser settings, or add photos instead.', retry: true },
  unavailable: { title: 'No camera here', body: 'Add a few photos instead. One or two per piece is perfect.', retry: false },
  insecure: { title: 'The camera needs a secure link', body: 'Open offload over https to film, or add photos instead.', retry: false },
  busy: { title: "Your camera's busy", body: 'Close any other app using it and try again, or add photos instead.', retry: true },
};

export function CameraBlocked({ reason, f }: { reason: CameraFailure; f: Filming }) {
  const copy = BLOCKED[reason];
  return (
    <Over label="Camera unavailable">
      <motion.span className="sl-over-icon" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING}>
        <VideoOff size={24} aria-hidden />
      </motion.span>
      <div role="alert" className="sl-over-copy">
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
      </div>
      <div className="sl-over-actions">
        <PickPhotos onFiles={f.addPhotos}>Add photos instead</PickPhotos>
        {copy.retry ? (
          <button className="text-link sl-over-link" onClick={f.retryCamera}>
            <RotateCcw size={15} aria-hidden /> Try the camera again
          </button>
        ) : null}
      </div>
    </Over>
  );
}

export function PhotosPanel({ f, cameraOk }: { f: Filming; cameraOk: boolean }) {
  const [text, setText] = useState('');
  const ready = f.photos.length > 0 || text.trim().length > 0;
  return (
    <Over label="Add photos instead" className="is-scroll">
      <div className="sl-photos">
        <span className="eyebrow">NO CAMERA? NO PROBLEM.</span>
        <h2>Add photos instead</h2>
        <p>One or two per piece is perfect. Labels and any marks help us price it right.</p>
        <motion.div className="sl-photo-grid" layout>
          <AnimatePresence initial={false}>
            {f.photos.map((p, i) => (
              <motion.div
                key={p.id}
                className="sl-photo-thumb"
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={SPRING}
              >
                <img src={p.src} alt="" />
                <button type="button" className="sl-photo-x" aria-label={`Remove photo ${i + 1}`} onClick={() => f.removePhoto(p.id)}>
                  <X size={14} aria-hidden />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
          {f.preparing ? (
            <div className="sl-photo-thumb is-loading" role="status" aria-label="Preparing photos">
              <Loader2 className="spin" size={20} aria-hidden />
            </div>
          ) : null}
        </motion.div>
        <PickPhotos onFiles={f.addPhotos} variant="outline">
          {f.photos.length ? 'Add more photos' : 'Choose photos'}
        </PickPhotos>
        {f.photoError ? (
          <p className="sl-over-error" role="alert">
            {f.photoError}
          </p>
        ) : f.photos.length ? (
          <p className="sl-over-count" role="status">
            {f.photos.length === 1 ? '1 photo ready' : `${f.photos.length} photos ready`}
          </p>
        ) : null}
        <label className="sl-field sl-field-dark">
          <span>What would you say about them?</span>
          <textarea
            name="story"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="Brands, sizes, where they're from, anything special, and what you'd want for it."
          />
        </label>
        <div className="sl-over-actions">
          <button className="button accent" disabled={!ready || f.preparing} onClick={() => f.sendPhotos(text)}>
            Get my estimate <Send size={17} aria-hidden />
          </button>
          {cameraOk ? (
            <button className="text-link sl-over-link" onClick={f.retryCamera}>
              <Camera size={15} aria-hidden /> Film instead
            </button>
          ) : null}
        </div>
      </div>
    </Over>
  );
}

export function StorySheet({ f }: { f: Filming }) {
  const [text, setText] = useState('');
  return (
    <Over label="Tell us about the pieces" className="is-scroll">
      <div className="sl-photos">
        <span className="sl-over-icon">
          <MicOff size={22} aria-hidden />
        </span>
        <h2>We couldn't hear you</h2>
        <p>Tell us a little about the pieces: brands, sizes, anything special, or what you'd want for one.</p>
        <label className="sl-field sl-field-dark">
          <span>About your pile</span>
          <textarea name="story" value={text} onChange={(e) => setText(e.target.value)} rows={5} autoFocus placeholder="The Levi's jacket is a medium, I've had it since sixth form…" />
        </label>
        <div className="sl-over-actions">
          <button className="button accent" onClick={() => f.submitStory(text)}>
            Get my estimate <Send size={17} aria-hidden />
          </button>
          <button className="text-link sl-over-link" onClick={() => f.submitStory('')}>
            Skip, just use the video
          </button>
        </div>
      </div>
    </Over>
  );
}

const LINES = {
  video: ['Reading the labels', 'Listening back to what you said', 'Counting the pieces', 'Working out a fair range'],
  photos: ['Looking through your photos', 'Reading the labels', 'Counting the pieces', 'Working out a fair range'],
};

// "Having a look at your pile..." with the frames flicking past like a deck of cards.
export function Thinking({ frames, photos = false }: { frames: string[]; photos?: boolean }) {
  const lines = LINES[photos ? 'photos' : 'video'];
  const [n, setN] = useState(0);
  const [line, setLine] = useState(0);
  const [slow, setSlow] = useState(false);
  const len = frames.length;
  useEffect(() => {
    if (len < 2) return;
    const t = setInterval(() => setN((x) => x + 1), 520);
    return () => clearInterval(t);
  }, [len]);
  useEffect(() => {
    const t = setInterval(() => setLine((x) => x + 1), 2400);
    const s = setTimeout(() => setSlow(true), 20000);
    return () => {
      clearInterval(t);
      clearTimeout(s);
    };
  }, []);
  const cards = [n - 2, n - 1, n].filter((k) => k >= 0);
  return (
    <Over label="Working out your estimate" className="is-think">
      <div className="sl-deck" aria-hidden>
        {len ? (
          <AnimatePresence initial={false}>
            {cards.map((k) => {
              const pos = n - k;
              return (
                <motion.img
                  key={k}
                  src={frames[k % len]}
                  alt=""
                  className="sl-deck-card"
                  style={{ zIndex: 3 - pos }}
                  initial={{ opacity: 0, y: 46, scale: 0.9, rotate: 0 }}
                  animate={{ opacity: pos === 0 ? 1 : pos === 1 ? 0.55 : 0.25, y: -pos * 14, scale: 1 - pos * 0.07, rotate: pos === 0 ? 0 : pos === 1 ? -6 : 7 }}
                  exit={{ opacity: 0, y: -40, scale: 0.84 }}
                  transition={{ duration: 0.45, ease: EASE }}
                />
              );
            })}
          </AnimatePresence>
        ) : (
          <div className="sl-deck-card is-empty">
            <ScanLine size={40} strokeWidth={1.4} />
          </div>
        )}
        <span className="sl-deck-scan" />
      </div>
      <div role="status">
        <h2 className="sl-think-title">
          Having a look at your {photos ? 'photos' : 'pile'}
          <span className="sl-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        </h2>
      </div>
      {/* Decorative progress chatter: announced once via the title, not every 2.4 s. */}
      <div className="sl-think-line" aria-hidden>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={line} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: EASE }}>
            {lines[line % lines.length]}…
          </motion.p>
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {slow ? (
          <motion.small className="sl-think-slow" role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            Still looking. Big piles take a little longer.
          </motion.small>
        ) : null}
      </AnimatePresence>
    </Over>
  );
}

function errorCopy(kind: NonNullable<Filming['failure']>['kind'], photos: boolean, message?: string) {
  const what = photos ? 'photos' : 'video';
  switch (kind) {
    case 'empty':
      return photos
        ? { title: "Couldn't spot the clothes", body: 'Try photos in better light, one piece per photo, with the label showing if you can.' }
        : { title: "Couldn't read that video", body: 'Try again in better light, and hold each piece up for a second or two while you talk.' };
    case 'nothing':
      return { title: "We didn't catch anything", body: 'Film for a few seconds and talk us through each piece.' };
    case 'details':
      return { title: 'Where should we collect from?', body: `Add your address beside the camera, then send it. Your ${what} ${photos ? 'are' : 'is'} still here.` };
    default:
      return { title: "Couldn't send that", body: `${message || 'Something went wrong.'} Your ${what} ${photos ? 'are' : 'is'} still here, so you can send ${photos ? 'them' : 'it'} again.` };
  }
}

export function FilmError({ f }: { f: Filming }) {
  const kind = f.failure?.kind || 'empty';
  const photos = f.failure?.source === 'photos';
  const copy = errorCopy(kind, photos, f.failure?.message);
  const canResend = kind === 'send' || kind === 'details';
  const Icon = kind === 'details' ? MapPin : kind === 'send' ? RotateCcw : Sun;
  return (
    <Over label="Something went wrong" className="is-error">
      <motion.span className="sl-over-icon is-warn" initial={{ scale: 0.6, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={SPRING}>
        <Icon size={24} aria-hidden />
      </motion.span>
      <div role="alert" className="sl-over-copy">
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
      </div>
      <div className="sl-over-actions">
        {canResend ? (
          <button className="button light" onClick={f.retrySend}>
            <RotateCcw size={17} aria-hidden /> {kind === 'details' ? 'Send it' : 'Send it again'}
          </button>
        ) : null}
        {photos ? (
          <PickPhotos onFiles={(files) => f.addPhotos(files, kind === 'empty')} variant={canResend ? 'outline' : 'light'}>
            {kind === 'empty' ? 'Try different photos' : 'Add more photos'}
          </PickPhotos>
        ) : (
          <button className={canResend ? 'text-link sl-over-link' : 'button light'} onClick={f.filmAgain}>
            <Camera size={17} aria-hidden /> Film again
          </button>
        )}
        {!canResend && !photos ? (
          <PickPhotos onFiles={f.addPhotos} variant="outline">
            Add photos instead
          </PickPhotos>
        ) : null}
      </div>
    </Over>
  );
}
