// The big visual area of the photo flow: camera prompt, review, grading, the grade reveal, and retake requests.
import { useEffect, useState } from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { AlertCircle, Check, FlipHorizontal2, ScanSearch, Shirt, Signature, Sparkles, Tag } from 'lucide-react';
import type { Item } from '../../types';
import { GRADE_LABEL, PRICE_SOURCE_LABEL } from '../../lib/selectors';
import { formatMoney } from '../../lib/money';
import { EASE, SPRING, SOFT_SPRING } from '../../components/motion';
import { Chip } from '../../components/ui';
import { the, type PhotoStep, type StepKey } from './copy';
import { Shutter } from './Shutter';
import { Money } from './Money';

const STEP_ICON: Record<StepKey, typeof Shirt> = {
  front: Shirt,
  back: FlipHorizontal2,
  label: Tag,
  marks: ScanSearch,
  claim: Signature,
};

const slide: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 48 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.42, ease: EASE } },
  exit: (dir: number) => ({ opacity: 0, x: dir * -48, transition: { duration: 0.24, ease: EASE } }),
};

export function CaptureStage({
  step,
  index,
  total,
  dir,
  bg,
  onShot,
  onSkip,
  onKeep,
}: {
  step: PhotoStep;
  index: number;
  total: number;
  dir: number;
  bg: string | null; // the photo already taken for this step (retake)
  onShot: (dataUrl: string) => void;
  onSkip: () => void;
  onKeep?: () => void; // back out of a retake and keep the photo that's there
}) {
  const Icon = STEP_ICON[step.key];
  return (
    <div className={`rn-stage ${step.key === 'claim' ? 'is-claim' : ''}`}>
      <AnimatePresence>
        {bg ? <motion.img key={bg.slice(-32)} className="rn-stage-bg" src={bg} alt="" initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} exit={{ opacity: 0 }} /> : null}
      </AnimatePresence>
      <div className="rn-stage-top">
        <span>
          STEP {index + 1} OF {total}
        </span>
        <span className="rn-stage-name">{step.name}</span>
      </div>
      <div className="rn-prompt-slot">
        <AnimatePresence mode="popLayout" custom={dir} initial={false}>
          <motion.div key={step.key} className="rn-prompt" custom={dir} variants={slide} initial="enter" animate="center" exit="exit">
            <span className="rn-prompt-icon" aria-hidden>
              <Icon size={22} />
            </span>
            <div>
              <strong>{step.prompt}</strong>
              <small>{step.hint}</small>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="rn-frame" aria-hidden>
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="rn-stage-bottom">
        <Shutter key={step.key} onShot={onShot} label={`Take the ${step.name.toLowerCase()} photo`} retake={Boolean(bg)} />
        <small>{bg ? 'Tap to retake it' : 'Tap to take the photo'}</small>
        {step.skip || (bg && onKeep) ? (
          <div className="rn-stage-alt">
            {bg && onKeep ? (
              <button type="button" className="rn-skip is-keep" onClick={onKeep}>
                Keep this one
              </button>
            ) : null}
            {step.skip ? (
              <button type="button" className="rn-skip" onClick={onSkip}>
                {step.skip}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ReviewStage({ cover, count, label }: { cover: string | null; count: number; label: string }) {
  return (
    <motion.div className="rn-stage is-review" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={SOFT_SPRING}>
      {cover ? <img className="rn-stage-bg is-bright" src={cover} alt={`Front of ${the(label)}`} /> : null}
      <div className="rn-review-card">
        <motion.span className="rn-review-tick" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ ...SPRING, delay: 0.1 }} aria-hidden>
          <Check size={20} strokeWidth={3} />
        </motion.span>
        <div>
          <strong>
            {count} photo{count === 1 ? '' : 's'} ready
          </strong>
          <small>Tap any photo below to retake it.</small>
        </div>
      </div>
    </motion.div>
  );
}

const GRADING_LINES = ['Sending the photos', 'Checking the condition', 'Looking up similar ones online', 'Setting a fair price'];

export function UploadingStage({ cover, label, retake }: { cover: string | null; label: string; retake: boolean }) {
  const [line, setLine] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setLine((l) => Math.min(l + 1, GRADING_LINES.length - 1)), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="rn-stage is-grading">
      {cover ? <img className="rn-stage-bg" src={cover} alt="" /> : null}
      <div className="rn-scan-track" aria-hidden>
        <motion.span className="rn-scan" animate={{ y: ['0%', '100%', '0%'] }} transition={{ duration: 2.6, ease: 'easeInOut', repeat: Infinity }} />
      </div>
      <div className="rn-grading-copy">
        <Sparkles size={22} aria-hidden />
        <strong>{retake ? `Checking the new photo of ${the(label)}…` : `Grading ${the(label)}…`}</strong>
        <AnimatePresence mode="wait">
          <motion.small key={line} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease: EASE }}>
            {GRADING_LINES[line]}…
          </motion.small>
        </AnimatePresence>
      </div>
    </div>
  );
}

export function ResultCard({ item }: { item: Item }) {
  const grade = item.grade;
  return (
    <motion.div className="rn-result" initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SOFT_SPRING}>
      <div className="rn-grade-wrap" aria-hidden>
        <motion.span className="rn-grade-glow" initial={{ scale: 0.4, opacity: 0.9 }} animate={{ scale: 1.9, opacity: 0 }} transition={{ duration: 1.1, ease: EASE, delay: 0.25 }} />
        <motion.span
          className={`rn-grade g-${grade || 'none'}`}
          initial={{ scale: 0.3, rotate: -20, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 16, delay: 0.12 }}
        >
          {grade || <Check size={34} strokeWidth={2.6} />}
        </motion.span>
      </div>
      <h3>
        <span aria-hidden>
          {grade ? `Graded ${grade}, listing at ` : 'Photographed, listing at '}
          <Money value={item.list_price} startFrom={Math.round(item.list_price * 0.6)} duration={0.8} />
        </span>
        <span className="sr-only">{`${grade ? `Graded ${grade}` : 'Photographed'}, listing at ${formatMoney(item.list_price)}`}</span>
      </h3>
      <p>
        {grade ? `${GRADE_LABEL[grade]}. ` : ''}
        {item.price_source === 'table' ? 'No price matches found, priced from our table.' : `Priced from ${PRICE_SOURCE_LABEL[item.price_source]}.`}
      </p>
      {item.condition_notes.length ? (
        <ul className="rn-notes">
          {item.condition_notes.slice(0, 3).map((n, i) => (
            <motion.li key={`${i}-${n}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35 + i * 0.08, duration: 0.4, ease: EASE }}>
              {n}
            </motion.li>
          ))}
        </ul>
      ) : null}
      {item.claim ? (
        <div className="rn-result-chips">
          {item.claim_proof ? (
            <Chip tone="green">
              <Check size={13} aria-hidden /> Close-up saved as proof
            </Chip>
          ) : (
            // The backend keeps an unproven claim off the listing; say so rather than imply it's on there.
            <Chip tone="warn">No clear close-up, so the claim stays off the listing</Chip>
          )}
        </div>
      ) : null}
    </motion.div>
  );
}

// Friendly retake cards, one per request, each with its own shutter right there.
export function RetakeStage({
  item,
  retakes,
  disabled,
  onShot,
}: {
  item: Item;
  retakes: Record<number, string>;
  disabled: boolean;
  onShot: (index: number, dataUrl: string) => void;
}) {
  const requests = item.photo_requests.length ? item.photo_requests : [`One more clear photo of ${the(item.label)}, in good light`];
  return (
    <motion.div className="rn-retake" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={SOFT_SPRING}>
      <div className="rn-retake-head">
        <motion.span className="rn-retake-icon" initial={{ rotate: -12, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={SPRING} aria-hidden>
          <AlertCircle size={22} />
        </motion.span>
        <div>
          <strong>{requests.length === 1 ? 'One more photo, please' : `${requests.length} more photos, please`}</strong>
          <small>Nearly there. This helps the buyer trust it.</small>
        </div>
      </div>
      <ol className="rn-requests">
        {requests.map((r, i) => {
          const shot = retakes[i];
          return (
            <motion.li key={`${i}-${r}`} className={shot ? 'is-done' : ''} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.08, duration: 0.4, ease: EASE }}>
              <p>{r}</p>
              <div className="rn-request-shot">
                <AnimatePresence initial={false}>
                  {shot ? (
                    <motion.img key={shot.slice(-24)} src={shot} alt="" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING} />
                  ) : null}
                </AnimatePresence>
                <Shutter size="md" onShot={(d) => onShot(i, d)} label={`Photo for: ${r}`} retake={Boolean(shot)} disabled={disabled} />
              </div>
            </motion.li>
          );
        })}
      </ol>
    </motion.div>
  );
}
