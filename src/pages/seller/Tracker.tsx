// Tracker: the agent's open questions (proof requests) on top, then the pickup timeline.
import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, Send, ShieldCheck, Sparkles, X } from 'lucide-react';
import { EASE, SPRING } from '../../components/motion';
import { Button, ErrorNote } from '../../components/ui';
import { api } from '../../lib/api';
import { fileToDataUrl } from '../../lib/images';
import { useAppState, useMutation } from '../../lib/state';
import type { AppState, Item, Job, Pickup } from '../../types';
import { possessive, trackerSteps } from './derive';
import { PickPhotos } from './FilmOverlays';
import { CheckDraw, Timeline } from './Timeline';

const MAX_PROOF = 6;

function ProofCard({ item, onSent }: { item: Item; onSent: (id: string) => void }) {
  const { upsert } = useAppState();
  const m = useMutation(api.sendProof);
  const [photos, setPhotos] = useState<{ id: number; src: string }[]>([]);
  const [note, setNote] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [readErr, setReadErr] = useState<string | null>(null);

  const add = async (files: File[]) => {
    setPreparing(true);
    setReadErr(null);
    const out: { id: number; src: string }[] = [];
    for (const f of files.slice(0, MAX_PROOF)) {
      try {
        out.push({ id: Date.now() + Math.random(), src: await fileToDataUrl(f) });
      } catch {
        setReadErr("Couldn't read one of those. Try a JPEG or PNG.");
      }
    }
    setPhotos((p) => [...p, ...out].slice(0, MAX_PROOF));
    setPreparing(false);
    if (photos.length + out.length > MAX_PROOF) setReadErr(`Up to ${MAX_PROOF} photos. We kept the first ${MAX_PROOF}.`);
  };

  const send = async () => {
    const res = await m.run(
      item.id,
      photos.map((p) => p.src),
      note.trim(),
    );
    if (res) {
      upsert('items', res);
      onSent(item.id);
    }
  };

  const ready = (photos.length > 0 || note.trim().length > 0) && !preparing;
  const noteId = `proof-note-${item.id}`;
  return (
    <div className="sl-proof">
      <div className="sl-proof-head">
        <span className="icon-disc">
          <Sparkles size={20} aria-hidden />
        </span>
        <div>
          <small className="sl-proof-kicker">A QUICK QUESTION ABOUT YOUR {item.label.toUpperCase()}</small>
          <h3>{item.proof_request}</h3>
        </div>
      </div>
      {photos.length || preparing ? (
        <motion.div className="sl-proof-thumbs" layout>
          <AnimatePresence initial={false}>
            {photos.map((p) => (
              <motion.span key={p.id} className="sl-proof-thumb" layout initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={SPRING}>
                <img src={p.src} alt="" />
                <button type="button" aria-label="Remove this photo" onClick={() => setPhotos((l) => l.filter((x) => x.id !== p.id))}>
                  <X size={13} aria-hidden />
                </button>
              </motion.span>
            ))}
          </AnimatePresence>
          {preparing ? (
            <span className="sl-proof-thumb is-loading" role="status" aria-label="Preparing photos">
              <Loader2 className="spin" size={18} aria-hidden />
            </span>
          ) : null}
        </motion.div>
      ) : null}
      <label className="sl-field" htmlFor={noteId}>
        <span>
          Anything to add? <em>Optional</em>
        </span>
        <textarea
          id={noteId}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={/\bsign/i.test(item.claim || '') ? 'Where it came from, who signed it, when…' : 'Where it came from, who made it, when…'}
        />
      </label>
      {readErr ? (
        <p className="sl-field-error" role="alert">
          {readErr}
        </p>
      ) : null}
      {m.error ? <ErrorNote onRetry={send}>{m.error}</ErrorNote> : null}
      <div className="sl-proof-actions">
        <PickPhotos onFiles={add} variant="light" disabled={m.pending || preparing}>
          {photos.length ? 'Add more' : 'Add photos'}
        </PickPhotos>
        <Button variant="dark" pending={m.pending} disabled={!ready} onClick={send}>
          Send <Send size={16} aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function ProofSent({ item }: { item: Item }) {
  return (
    <div className="sl-proof is-sent" role="status">
      <div className="sl-proof-head">
        <motion.span className="icon-disc sl-sent-disc" initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={SPRING}>
          <CheckDraw size={20} />
        </motion.span>
        <div>
          <small className="sl-proof-kicker">SENT</small>
          <h3>Thanks, that really helps.</h3>
          <p>It's saved with your {item.label}. Proof like this helps buyers trust the listing.</p>
        </div>
      </div>
    </div>
  );
}

export function ProofList({ items, sent, onSent }: { items: Item[]; sent: string[]; onSent: (id: string) => void }) {
  const asks = items.filter((i) => i.proof_request || sent.includes(i.id));
  if (!asks.length) return null;
  return (
    <div className="sl-proofs">
      <AnimatePresence initial={false}>
        {asks.map((it) => {
          const open = !!it.proof_request && !sent.includes(it.id);
          return (
            <motion.div key={it.id} layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.45, ease: EASE }}>
              {/* Question -> thank-you is a crossfade, not a jump. */}
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={open ? 'ask' : 'sent'}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.25, ease: EASE }}
                >
                  {open ? <ProofCard item={it} onSent={onSent} /> : <ProofSent item={it} />}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// "Sent" cards live above the tab panel so the thank-you survives switching tabs (the backend clears
// proof_request, so without this the card would just vanish).
export function useProofSent() {
  const [sent, setSent] = useState<string[]>([]);
  const onSent = useCallback((id: string) => setSent((s) => (s.includes(id) ? s : [...s, id])), []);
  return { sent, onSent };
}

export function Tracker({
  state,
  pickup,
  items,
  job,
  sent,
  onSent,
  desk = false,
}: {
  state: AppState;
  pickup: Pickup;
  items: Item[];
  job: Job | null;
  sent: string[];
  onSent: (id: string) => void;
  desk?: boolean;
}) {
  const steps = trackerSteps(state, pickup, job);
  const hasAsks = items.some((i) => i.proof_request || sent.includes(i.id));

  const timeline = (
    <section className="panel sl-track">
      <span className="eyebrow">{possessive(pickup.seller_name).toUpperCase()} PILE</span>
      <h2>
        From your door
        <br />
        to their wardrobe.
      </h2>
      <Timeline steps={steps} />
    </section>
  );

  if (!desk) {
    return (
      <div className="sl-tracker">
        <ProofList items={items} sent={sent} onSent={onSent} />
        {timeline}
      </div>
    );
  }
  return (
    <div className="tracker-grid sl-tracker is-desk">
      {timeline}
      <div className="sl-tracker-side">
        {hasAsks ? (
          <ProofList items={items} sent={sent} onSent={onSent} />
        ) : (
          <div className="panel lavender sl-calm">
            <ShieldCheck size={26} aria-hidden />
            <h3>Nothing needed from you.</h3>
            <p>If a buyer or the agent needs a detail, like proof of a signature, it'll show up here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
