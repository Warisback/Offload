// Guided photos: one item at a time, one step at a time. Photos stay in the photo book until the server has them.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Lock, Upload } from 'lucide-react';
import type { Item } from '../../types';
import { Button, Chip, ErrorNote } from '../../components/ui';
import { EASE } from '../../components/motion';
import { formatMoney } from '../../lib/money';
import { claimLastOrder, isPending, keepStageInView, orderedShots, stepsFor, the, type StepKey } from './copy';
import { setRetake, setShot, skipStep, useShots, type ItemShots } from './photoBook';
import { useRunner } from './session';
import { ItemRail, ProgressBar, SentStrip, Thumbs } from './FlowParts';
import { CaptureStage, ResultCard, RetakeStage, ReviewStage, UploadingStage } from './Stage';

type Mode = 'capture' | 'review' | 'uploading' | 'retake' | 'result';

// A short white flash on the stage each time a new photo lands: the native camera has just closed, and this is the
// "got it" beat (the thumbnail pops in below at the same moment). Clearing photos after an upload never flashes.
function useCaptureFlash(itemId: string | null, keys: StepKey[], shots: ItemShots) {
  const sig = keys.map((k) => shots.shots[k]?.slice(-16) ?? '');
  const sigKey = sig.join('|');
  const prev = useRef<{ id: string | null; sig: string[] }>({ id: null, sig: [] });
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    const p = prev.current;
    prev.current = { id: itemId, sig };
    if (p.id === itemId && sig.some((v, i) => v && v !== p.sig[i])) setFlash((f) => f + 1);
    // sig is derived from sigKey; depending on the joined key keeps this from running on every render.
  }, [itemId, sigKey]);
  return flash;
}

export function PhotoFlow({ items, listed = false }: { items: Item[]; listed?: boolean }) {
  const { flow, setFlow, uploads, upload, clearUploadError } = useRunner();

  const pending = items.filter(isPending);
  const resultItem = flow.resultId ? items.find((i) => i.id === flow.resultId && !isPending(i)) : undefined;
  const chosen = flow.focusId ? items.find((i) => i.id === flow.focusId && isPending(i)) : undefined;
  const focus = resultItem || chosen || pending[0] || null;
  const focusId = focus?.id ?? null;

  const shots = useShots(focusId);
  const steps = focus ? stepsFor(focus) : [];
  const has = (k: StepKey) => Boolean(shots.shots[k]) || shots.skipped.includes(k);
  const picked = focus ? flow.pick[focus.id] ?? null : null;
  const current = steps.find((s) => s.key === picked) || steps.find((s) => !has(s.key)) || null;
  const stepIdx = current ? steps.indexOf(current) : steps.length;
  const flash = useCaptureFlash(focusId, steps.map((s) => s.key), shots);

  // Slide direction for the step prompt: forward unless the runner went back to retake.
  const prev = useRef<{ id: string | null; idx: number }>({ id: null, idx: 0 });
  const dir = prev.current.id === focusId && stepIdx < prev.current.idx ? -1 : 1;
  useEffect(() => {
    prev.current = { id: focusId, idx: stepIdx };
  });

  const up = focus ? uploads[focus.id] : undefined;
  const mode: Mode =
    resultItem && focus?.id === resultItem.id
      ? 'result'
      : up?.pending
        ? 'uploading'
        : focus?.status === 'needs_photos'
          ? 'retake'
          : current
            ? 'capture'
            : 'review';

  // A new item, a grade reveal or a retake request: make sure the stage is on screen (short phones start mid-page,
  // and the runner is usually scrolled down at the button they just pressed).
  const root = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const scrollBeat = mode === 'result' || mode === 'retake' ? mode : 'work';
  useEffect(() => {
    if (!focusId) return;
    const raf = requestAnimationFrame(() => keepStageInView(root.current, stageRef.current));
    return () => cancelAnimationFrame(raf);
  }, [focusId, scrollBeat]);

  if (!focus) return null;

  const index = items.indexOf(focus);
  const doneCount = items.filter((i) => !isPending(i)).length;
  const cover = shots.shots.front || Object.values(shots.shots)[0] || focus.photos[0] || null;
  const takenCount = Object.keys(shots.shots).length;
  const retakeIdx = Object.keys(shots.retakes).map(Number).sort((a, b) => a - b);
  const locked = mode === 'retake' || mode === 'uploading';

  const after = items.slice(index + 1).concat(items.slice(0, index));
  const next = after.find((i) => isPending(i) && i.id !== focus.id) || null;

  const pick = (k: StepKey | null) => setFlow((f) => ({ ...f, focusId: focus.id, pick: { ...f.pick, [focus.id]: k } }));
  const onShot = (d: string) => {
    if (!current) return;
    setShot(focus.id, current.key, d);
    pick(null);
  };
  const onSkip = () => {
    if (!current) return;
    skipStep(focus.id, current.key);
    pick(null);
  };
  const doUpload = () => upload(focus.id, orderedShots(steps.map((s) => s.key), shots.shots), 'first');
  const doRetake = () => upload(focus.id, claimLastOrder(focus, retakeIdx).map((i) => shots.retakes[i]), 'retake');
  const goNext = () => setFlow((f) => ({ ...f, resultId: null, focusId: next?.id ?? null }));
  const goItem = (id: string) => setFlow((f) => ({ ...f, resultId: null, focusId: id }));

  // One persistent live region, so screen readers hear each beat once (regions that mount with content are often skipped).
  const requests = focus.photo_requests.length ? focus.photo_requests : ['One more clear photo, in good light.'];
  const announce =
    mode === 'capture' && current
      ? `${focus.label}. Step ${stepIdx + 1} of ${steps.length}, ${current.name}: ${current.prompt}`
      : mode === 'review'
        ? `${takenCount} photo${takenCount === 1 ? '' : 's'} ready. Upload and grade when you're ready.`
        : mode === 'uploading'
          ? `Grading ${the(focus.label)}. This usually takes a few seconds.`
          : mode === 'retake'
            ? `One more photo needed for ${the(focus.label)}: ${requests.join('. ')}`
            : `${focus.grade ? `Graded ${focus.grade}` : 'Photographed'}, listing at ${formatMoney(focus.list_price)}.`;

  return (
    <div className={`rn-flow mode-${mode}`} ref={root}>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <div className="rn-flow-head">
        <div className="rn-count">
          <strong>
            Item {index + 1} of {items.length}
          </strong>
          <span>
            {doneCount} of {items.length} done
          </span>
        </div>
        <ProgressBar value={items.length ? doneCount / items.length : 0} label={`${doneCount} of ${items.length} items done`} />
        <ItemRail items={items} focusId={focus.id} locked={locked} onPick={goItem} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={focus.id}
            className="rn-item-title"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <h2>{focus.label}</h2>
            <div className="rn-item-chips">
              {focus.size ? <Chip>Size {focus.size}</Chip> : null}
              {focus.brand ? <Chip>{focus.brand}</Chip> : null}
              {focus.claim ? <Chip tone="peach">Needs a close-up</Chip> : null}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="rn-flow-stage" ref={stageRef}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${focus.id}-${mode}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            {mode === 'capture' && current ? (
              <CaptureStage
                step={current}
                index={stepIdx}
                total={steps.length}
                dir={dir}
                bg={shots.shots[current.key] || null}
                onShot={onShot}
                onSkip={onSkip}
                onKeep={shots.shots[current.key] ? () => pick(null) : undefined}
              />
            ) : mode === 'review' ? (
              <ReviewStage cover={cover} count={takenCount} label={focus.label} />
            ) : mode === 'uploading' ? (
              <UploadingStage cover={up?.kind === 'retake' ? shots.retakes[retakeIdx[0]] || cover : cover} label={focus.label} retake={up?.kind === 'retake'} />
            ) : mode === 'retake' ? (
              <RetakeStage item={focus} retakes={shots.retakes} disabled={false} onShot={(i, d) => setRetake(focus.id, i, d)} />
            ) : (
              <ResultCard item={focus} />
            )}
          </motion.div>
        </AnimatePresence>
        <AnimatePresence initial={false}>
          <motion.span
            key={flash}
            className="rn-flash"
            aria-hidden
            initial={{ opacity: 0.75 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
          />
        </AnimatePresence>
      </div>

      <div className="rn-flow-actions">
        {mode === 'review' ? (
          <>
            <Button variant="accent" className="rn-cta" onClick={doUpload} disabled={!takenCount}>
              <Upload size={19} aria-hidden /> Upload & grade
            </Button>
            {up?.error ? (
              <ErrorNote
                onRetry={() => {
                  clearUploadError(focus.id);
                  doUpload();
                }}
              >
                {up.error} Your photos are still here.
              </ErrorNote>
            ) : null}
          </>
        ) : null}
        {mode === 'uploading' ? <p className="rn-hold">Keep this page open. It usually takes a few seconds.</p> : null}
        {mode === 'retake' ? (
          <>
            <Button variant="accent" className="rn-cta" onClick={doRetake} disabled={!retakeIdx.length}>
              <Upload size={19} aria-hidden /> {retakeIdx.length > 1 ? `Send ${retakeIdx.length} photos` : 'Send photo'}
            </Button>
            {up?.error ? (
              <ErrorNote
                onRetry={() => {
                  clearUploadError(focus.id);
                  doRetake();
                }}
              >
                {up.error} Your photos are still here.
              </ErrorNote>
            ) : null}
            <p className="rn-lock">
              <Lock size={14} aria-hidden /> Fix this one to move on to the next item.
            </p>
          </>
        ) : null}
        {mode === 'result' ? (
          <>
            <Button className="rn-cta" onClick={goNext}>
              {next ? 'Next item' : listed ? 'All done' : 'All done, hand over'} <ArrowRight size={19} aria-hidden />
            </Button>
            {!next && listed ? <p className="rn-hold">It goes straight on the shop with the rest of the pile.</p> : null}
          </>
        ) : null}
      </div>

      <div className="rn-flow-thumbs">
        {mode === 'capture' || mode === 'review' || mode === 'uploading' ? (
          <Thumbs steps={steps} shots={shots} current={mode === 'capture' ? current?.key ?? null : null} onPick={(k) => pick(k)} disabled={mode === 'uploading'} />
        ) : (
          <SentStrip photos={focus.photos} label={mode === 'result' ? 'On the listing' : 'Sent so far'} />
        )}
      </div>
    </div>
  );
}
