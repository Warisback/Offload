// Small pieces of the guided photo flow: progress, the item rail, step thumbnails, and the "sent so far" strip.
import type { CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, Check, Minus } from 'lucide-react';
import type { Item } from '../../types';
import { SPRING, EASE } from '../../components/motion';
import { isPending, type PhotoStep, type StepKey } from './copy';
import type { ItemShots } from './photoBook';

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const p = Math.max(0, Math.min(1, value));
  return (
    <div className="rn-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
      <motion.span
        className="rn-progress-fill"
        style={{ '--p': p } as CSSProperties}
        initial={false}
        animate={{ scaleX: p }}
        transition={{ duration: 0.7, ease: EASE }}
      />
    </div>
  );
}

// One pill per item: done ones get a check, ones waiting on a retake get a warning dot.
export function ItemRail({
  items,
  focusId,
  locked,
  onPick,
}: {
  items: Item[];
  focusId: string;
  locked: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <ol className="rn-rail" aria-label="Items in this pickup">
      {items.map((it, i) => {
        const current = it.id === focusId;
        const done = !isPending(it);
        const needs = it.status === 'needs_photos';
        const canPick = !current && !locked && isPending(it);
        return (
          <li key={it.id}>
            <button
              type="button"
              className={`rn-rail-pill ${current ? 'is-current' : ''} ${done ? 'is-done' : ''} ${needs ? 'is-needs' : ''}`}
              onClick={() => canPick && onPick(it.id)}
              disabled={!canPick && !current}
              aria-current={current ? 'step' : undefined}
              aria-label={`${it.label}: ${done ? 'done' : needs ? 'needs a retake' : 'to do'}`}
              title={it.label}
            >
              {current ? <motion.span layoutId="rn-rail-current" className="rn-rail-bg" transition={SPRING} /> : null}
              <span className="rn-rail-in">
                {done ? <Check size={14} strokeWidth={2.6} aria-hidden /> : needs ? <AlertCircle size={14} aria-hidden /> : i + 1}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// One slot per step. Filled slots pop their photo in; tap any slot to (re)take that step.
export function Thumbs({
  steps,
  shots,
  current,
  onPick,
  disabled,
}: {
  steps: PhotoStep[];
  shots: ItemShots;
  current: StepKey | null;
  onPick: (k: StepKey) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rn-thumbs" role="group" aria-label="Photos for this item">
      {steps.map((s, i) => {
        const src = shots.shots[s.key];
        const skipped = shots.skipped.includes(s.key);
        const active = current === s.key;
        return (
          <motion.button
            type="button"
            layout
            key={s.key}
            className={`rn-thumb ${active ? 'is-active' : ''} ${src ? 'is-filled' : ''} ${skipped ? 'is-skipped' : ''}`}
            onClick={() => onPick(s.key)}
            disabled={disabled}
            aria-label={`${s.name}: ${src ? 'taken, tap to retake' : skipped ? 'skipped, tap to take it anyway' : 'not taken yet'}`}
            whileTap={disabled ? undefined : { scale: 0.94 }}
            transition={SPRING}
          >
            <span className="rn-thumb-img">
              <AnimatePresence initial={false}>
                {src ? (
                  <motion.img
                    key={`${s.key}-${src.length}-${src.slice(-24)}`}
                    src={src}
                    alt=""
                    initial={{ scale: 0.55, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={SPRING}
                  />
                ) : null}
              </AnimatePresence>
              {!src ? <span className="rn-thumb-empty">{skipped ? <Minus size={16} aria-hidden /> : i + 1}</span> : null}
              {src ? (
                <motion.span className="rn-thumb-tick" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...SPRING, delay: 0.12 }} aria-hidden>
                  <Check size={11} strokeWidth={3} />
                </motion.span>
              ) : null}
            </span>
            <small>{skipped ? 'Skipped' : s.name}</small>
          </motion.button>
        );
      })}
    </div>
  );
}

// Photos the server already has for this item.
export function SentStrip({ photos, label = 'Sent so far' }: { photos: string[]; label?: string }) {
  if (!photos.length) return null;
  const shown = photos.slice(-8);
  return (
    <div className="rn-sent">
      <span className="rn-sent-label">{label}</span>
      <div className="rn-sent-row">
        <AnimatePresence initial={false}>
          {shown.map((src, i) => (
            <motion.img
              key={src.slice(-48) + i}
              layout
              src={src}
              alt=""
              loading="lazy"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ ...SPRING, delay: i * 0.03 }}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
