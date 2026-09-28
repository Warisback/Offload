// The pickup I'm working on: Collect -> Photos -> Hand over, with a stepper so a first-timer always knows where they are.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Check, MapPin, Package, Shirt, Store, X } from 'lucide-react';
import type { Job, Pickup } from '../../types';
import { api } from '../../lib/api';
import { useAppState, useMutation } from '../../lib/state';
import { formatMoney } from '../../lib/money';
import { Button, Chip, ErrorNote, Loading } from '../../components/ui';
import { EASE, SPRING } from '../../components/motion';
import { bringIntoView, isPending, mapsUrl, plural, rest, street } from './copy';
import { jobInfo, type JobInfo } from './derive';
import { useRunner } from './session';
import { PhotoFlow } from './PhotoFlow';

type Stage = 'collect' | 'photos' | 'waiting' | 'handover';

const STAGES: { key: Stage; label: string }[] = [
  { key: 'collect', label: 'Collect' },
  { key: 'photos', label: 'Photos' },
  { key: 'handover', label: 'Hand over' },
];

function stageOf(job: Job, info: JobInfo, skipped: string[], resultId: string | null): Stage {
  const { pickup, items } = info;
  const collected = job.status === 'done' || pickup?.status === 'collected' || pickup?.status === 'listed' || skipped.includes(job.id);
  if (!collected) return 'collect';
  if (!items.length) return 'waiting';
  const showingResult = Boolean(resultId && items.some((i) => i.id === resultId));
  return items.some(isPending) || showingResult ? 'photos' : 'handover';
}

// Marks the pickup collected first if the runner skipped that button, then hands over.
async function handoverFlow(job: Job, pickupId: string): Promise<{ job: Job | null; pickup: Pickup }> {
  const doneJob = job.status === 'done' ? null : await api.jobDone(job.id);
  const pickup = await api.handover(pickupId);
  return { job: doneJob, pickup };
}

function Stepper({ stage }: { stage: Stage }) {
  const at = stage === 'collect' ? 0 : stage === 'handover' ? 2 : 1;
  return (
    <ol className="rn-stepper" aria-label="Pickup progress">
      {STAGES.map((s, i) => (
        <li key={s.key} className={i < at ? 'is-done' : i === at ? 'is-now' : ''} aria-current={i === at ? 'step' : undefined}>
          {i === at ? <motion.span layoutId="rn-stepper-pill" className="rn-stepper-pill" transition={SPRING} /> : null}
          <span className="rn-stepper-dot" aria-hidden>
            {i < at ? <Check size={13} strokeWidth={3} /> : i + 1}
          </span>
          <span className="rn-stepper-label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function ActiveJob({ job, onClose }: { job: Job; onClose?: () => void }) {
  const { state, upsert } = useAppState();
  const { skipped, skipCollect, flow, setCelebrate } = useRunner();
  const collect = useMutation(api.jobDone);
  const hand = useMutation(handoverFlow);
  const [note, setNote] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const lastStage = useRef<string | null>(null);

  const info = state ? jobInfo(state, job) : null;
  const stageKey = info ? stageOf(job, info, skipped, flow.resultId) : null;
  // When the stage changes (not on first paint), bring the stepper back into view.
  useEffect(() => {
    if (lastStage.current && stageKey && lastStage.current !== stageKey && stageKey !== 'photos') bringIntoView(root.current);
    lastStage.current = stageKey;
  }, [stageKey]);

  if (!state || !info) return null;
  const { pickup, items, labels, count } = info;
  const seller = pickup?.seller_name || 'The seller';
  const stage = stageKey as Stage;
  const ready = items.filter((i) => !isPending(i)).length;

  const doCollect = async () => {
    const out = await collect.run(job.id);
    if (out) upsert('jobs', out);
  };
  const doHandover = async () => {
    setNote(null);
    const out = await hand.run(job, job.pickup_id);
    if (!out) return;
    if (out.job) upsert('jobs', out.job);
    upsert('pickups', out.pickup);
    if (out.pickup.status === 'listed') setCelebrate({ jobId: job.id, pickupId: job.pickup_id, count: ready, pay: job.pay });
    else setNote("The shop didn't take them just yet. Give it a moment and try again.");
  };

  return (
    <motion.section ref={root} className="rn-active" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
      <header className="rn-active-head">
        <div className="rn-active-where">
          <span className="eyebrow">YOUR PICKUP · {seller.toUpperCase()}</span>
          <h2 tabIndex={-1}>{street(job.address)}</h2>
          {rest(job.address) ? (
            <p>
              <MapPin size={14} aria-hidden /> {rest(job.address)}
            </p>
          ) : null}
        </div>
        <div className="rn-active-pay">
          <strong>{formatMoney(job.pay)}</strong>
          <small>for this pickup</small>
        </div>
        {onClose ? (
          <button type="button" className="round-button rn-close" aria-label="Back to the job list" onClick={onClose}>
            <X size={18} />
          </button>
        ) : null}
      </header>

      <Stepper stage={stage} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={stage}
          className="rn-active-body"
          initial={{ opacity: 0, x: 32 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -32 }}
          transition={{ duration: 0.38, ease: EASE }}
        >
          {stage === 'collect' ? (
            <div className="rn-collect">
              {job.status === 'accepted' ? (
                <motion.p className="rn-yours" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...SPRING, delay: 0.15 }}>
                  <span aria-hidden>
                    <Check size={14} strokeWidth={3} />
                  </span>
                  It’s yours. Head over when you’re ready.
                </motion.p>
              ) : null}
              <div className="rn-route">
                <span className="rn-route-pin" aria-hidden>
                  <MapPin size={22} />
                </span>
                <div>
                  <small>Head to</small>
                  <strong>{street(job.address)}</strong>
                  {rest(job.address) ? <span>{rest(job.address)}</span> : null}
                </div>
                <a className="rn-maps" href={mapsUrl(job.address)} target="_blank" rel="noreferrer">
                  Open in Maps <ArrowUpRight size={15} aria-hidden />
                </a>
              </div>
              <div className="rn-pile">
                <span className="rn-pile-title">
                  {seller} has {plural(count, 'item')} ready for you
                </span>
                <ul>
                  {(items.length ? items.map((i) => ({ label: i.label, special: Boolean(i.claim) })) : labels.map((l) => ({ label: l, special: false }))).map((it, i) => (
                    <motion.li key={`${it.label}-${i}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.08 + i * 0.05, duration: 0.4, ease: EASE }}>
                      <Shirt size={16} aria-hidden />
                      <span>{it.label}</span>
                      {it.special ? <Chip tone="peach">Special</Chip> : null}
                    </motion.li>
                  ))}
                </ul>
              </div>
              <div className="rn-cta-bar">
                <Button className="rn-cta" pending={collect.pending} onClick={doCollect}>
                  <Package size={19} aria-hidden /> I’ve got the pile
                </Button>
                {collect.error ? <ErrorNote onRetry={doCollect}>{collect.error}</ErrorNote> : null}
                <button type="button" className="text-link rn-skip-link" onClick={() => skipCollect(job.id)} disabled={collect.pending}>
                  Already got it? Skip to photos
                </button>
              </div>
            </div>
          ) : stage === 'waiting' ? (
            <Loading label="Getting the item list. It'll show up here in a moment." />
          ) : stage === 'photos' ? (
            <PhotoFlow items={items} listed={pickup?.status === 'listed'} />
          ) : (
            <div className="rn-handover">
              <div className="rn-mosaic" aria-hidden>
                {items.map((it, i) => (
                  <motion.div key={it.id} className="rn-mosaic-tile" initial={{ opacity: 0, scale: 0.7, rotate: i % 2 ? 4 : -4 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ ...SPRING, delay: i * 0.06 }}>
                    {it.photos[0] ? <img src={it.photos[0]} alt="" loading="lazy" /> : <Shirt size={22} />}
                    {it.grade ? <span className="rn-mosaic-grade">{it.grade}</span> : null}
                  </motion.div>
                ))}
              </div>
              <h3>{ready === 1 ? 'Your item is photographed' : `All ${ready} items photographed`}</h3>
              <p>Hand the pile over and we’ll list everything on the shop straight away.</p>
              <div className="rn-cta-bar">
                <Button variant="accent" className="rn-cta" pending={hand.pending} onClick={doHandover}>
                  <Store size={19} aria-hidden /> Confirm handover
                </Button>
                <div aria-live="polite">
                  {hand.pending ? <p className="rn-hold">Putting them on the shop…</p> : null}
                  {note ? <p className="rn-hold">{note}</p> : null}
                </div>
                {hand.error ? <ErrorNote onRetry={doHandover}>{hand.error}</ErrorNote> : null}
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </motion.section>
  );
}
