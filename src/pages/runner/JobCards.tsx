// Job cards: open pickups (Accept), my pickups, done ones, "someone got there first", and posting jobs.
import { useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, Handshake, MapPin, Package, ShieldCheck, Truck } from 'lucide-react';
import type { Job } from '../../types';
import { api } from '../../lib/api';
import { useAppState, useMutation } from '../../lib/state';
import { sameName } from '../../lib/selectors';
import { formatMoney } from '../../lib/money';
import { Button, Chip, ErrorNote } from '../../components/ui';
import { EASE, SPRING } from '../../components/motion';
import { isPending, plural, street, the } from './copy';
import { jobInfo, postItemLabel } from './derive';
import { useRunner } from './session';

const enter = (i: number) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: EASE, delay: Math.min(i, 6) * 0.07 } });

type Variant = 'open' | 'active' | 'queued' | 'done';

export function PickupJobCard({
  job,
  variant,
  index = 0,
  highlight = false,
  onAccepted,
  onOpen,
}: {
  job: Job;
  variant: Variant;
  index?: number;
  highlight?: boolean;
  onAccepted?: (job: Job) => void;
  onOpen?: () => void;
}) {
  const { state, upsert } = useAppState();
  const { name, addTaken, setPreferred } = useRunner();
  const accept = useMutation(api.acceptJob);
  if (!state) return null;
  const { pickup, items, labels, count } = jobInfo(state, job);
  const shown = labels.slice(0, 3);
  const more = labels.length - shown.length;
  const photographed = items.filter((i) => !isPending(i)).length;

  const doAccept = async () => {
    if (!name) return;
    const out = await accept.run(job.id, name);
    if (!out) return;
    upsert('jobs', out);
    if (sameName(out.runner_name, name)) {
      setPreferred(out.id); // the pickup they just took is the one on screen, even if an older one is unfinished
      onAccepted?.(out);
      // The Accept button that had focus is gone; hand focus to the pickup's heading once it has rendered.
      setTimeout(() => document.querySelector<HTMLElement>('.rn-active-where h2')?.focus({ preventScroll: true }), 80);
    } else addTaken(out);
  };
  const doSwitch = () => {
    setPreferred(job.id);
    onOpen?.();
  };

  const chip =
    variant === 'open' ? (
      <Chip tone={highlight ? 'accent' : 'plain'}>{highlight ? 'NEXT NEARBY' : 'NEW PICKUP'}</Chip>
    ) : variant === 'active' ? (
      <Chip tone="accent">
        <span className="rn-live-dot" aria-hidden /> IN PROGRESS
      </Chip>
    ) : variant === 'queued' ? (
      <Chip>ON YOUR LIST</Chip>
    ) : (
      <Chip tone="green">
        <Check size={12} aria-hidden /> DONE
      </Chip>
    );

  return (
    <motion.article
      layout
      className={`rn-job v-${variant} ${highlight ? 'is-next' : ''}`}
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={enter(index)}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.25 } }}
      transition={SPRING}
    >
      <div className="rn-job-top">
        {chip}
        <span>{pickup?.seller_name ? `${pickup.seller_name}’s pile` : 'Pickup'} · Today</span>
      </div>
      <div className="rn-job-main">
        <span className="rn-job-icon" aria-hidden>
          <Package size={26} />
        </span>
        <div className="rn-job-what">
          <h3>
            {variant === 'done'
              ? `${plural(count, 'item')} collected`
              : job.status === 'done' && count > photographed
                ? `${plural(count - photographed, 'item')} still to photograph`
                : `${plural(count, 'item')} to collect`}
          </h3>
          <p>
            <MapPin size={14} aria-hidden /> {job.address}
          </p>
        </div>
        <div className="rn-job-pay">
          <strong>
            {variant === 'done' ? '+' : ''}
            {formatMoney(job.pay)}
          </strong>
          <small>for this pickup</small>
        </div>
      </div>
      {shown.length ? (
        <ul className="rn-job-items" aria-label="Items">
          {shown.map((l, i) => (
            <li key={`${l}-${i}`}>{l}</li>
          ))}
          {more > 0 ? <li className="is-more">+{more} more</li> : null}
        </ul>
      ) : null}
      <div className="rn-job-bottom">
        <span className="rn-verified">
          <ShieldCheck size={16} aria-hidden /> Verified runner
        </span>
        {variant === 'open' ? (
          <Button className="rn-accept" pending={accept.pending} onClick={doAccept} disabled={!name}>
            Accept <ArrowRight size={19} aria-hidden />
          </Button>
        ) : variant === 'active' && onOpen ? (
          <Button className="rn-accept" onClick={onOpen}>
            {photographed ? `Continue · ${photographed} of ${count} done` : 'Start the pickup'} <ArrowRight size={19} aria-hidden />
          </Button>
        ) : variant === 'queued' ? (
          <Button variant="outline" className="rn-accept" onClick={doSwitch}>
            Work on this one <ArrowRight size={19} aria-hidden />
          </Button>
        ) : null}
      </div>
      {accept.error ? <ErrorNote onRetry={doAccept}>{accept.error}</ErrorNote> : null}
    </motion.article>
  );
}

export function TakenCard({ job, index = 0 }: { job: Job; index?: number }) {
  const { dismissTaken } = useRunner();
  return (
    <motion.article
      layout
      className="rn-taken"
      initial={{ opacity: 0, y: 12 }}
      animate={enter(index)}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.25 } }}
      transition={SPRING}
      role="status"
    >
      <span className="rn-taken-icon" aria-hidden>
        <Handshake size={20} />
      </span>
      <div>
        <strong>{job.runner_name || 'Another runner'} got there first.</strong>
        <p>No worries, the pickup at {street(job.address)} is sorted.</p>
      </div>
      <button type="button" className="text-link" onClick={() => dismissTaken(job.id)}>
        OK
      </button>
    </motion.article>
  );
}

function PostCard({ job, index, fresh }: { job: Job; index: number; fresh: boolean }) {
  const { state, upsert } = useAppState();
  const { name } = useRunner();
  const done = useMutation(api.jobDone);
  const take = useMutation(api.acceptJob);
  if (!state) return null;
  const label = postItemLabel(state, job);
  const open = job.status === 'open';

  const doDone = async () => {
    const out = await done.run(job.id);
    if (out) upsert('jobs', out);
  };
  const doTake = async () => {
    if (!name) return;
    const out = await take.run(job.id, name);
    if (out) upsert('jobs', out);
  };
  const error = done.error || take.error;

  return (
    <motion.article
      layout
      className={`rn-post ${fresh ? 'is-new' : ''}`}
      initial={{ opacity: 0, x: 48, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1, transition: { ...SPRING, delay: Math.min(index, 4) * 0.06 } }}
      exit={{ opacity: 0, x: -48, scale: 0.96, transition: { duration: 0.3, ease: EASE } }}
      transition={SPRING}
    >
      <span className="rn-post-icon" aria-hidden>
        <Truck size={22} />
      </span>
      <div className="rn-post-body">
        <Chip tone="green">{open ? 'UP FOR GRABS' : 'READY TO POST'}</Chip>
        <h3>
          Post {the(label)}
          {job.pay > 0 ? `, ${formatMoney(job.pay)}` : ''}
        </h3>
        <p>
          <MapPin size={13} aria-hidden /> {job.address}
        </p>
        <small>{open ? 'Covered by the pickup pay' : 'Included in your pickup pay'}</small>
      </div>
      <div className="rn-post-action">
        {open ? (
          <Button pending={take.pending} onClick={doTake} disabled={!name}>
            I’ll post it
          </Button>
        ) : (
          <Button pending={done.pending} onClick={doDone}>
            <Check size={18} aria-hidden /> Posted
          </Button>
        )}
      </div>
      {error ? <ErrorNote onRetry={open ? doTake : doDone}>{error}</ErrorNote> : null}
    </motion.article>
  );
}

// Posting jobs. Ones that land while the page is open slide in and glow once.
export function PostList({ jobs }: { jobs: Job[] }) {
  const initial = useRef<Set<string> | null>(null);
  if (initial.current === null) initial.current = new Set(jobs.map((j) => j.id));
  const seen = initial.current;
  return (
    <section className="rn-section" aria-label="Posting jobs" aria-live="polite">
      <AnimatePresence initial={false}>
        {jobs.length ? (
          <motion.div key="head" className="rn-section-head" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <span className="eyebrow">{jobs.length === 1 ? 'A SALE LANDED' : 'SALES TO POST'}</span>
            <span className="rn-count-pill">{jobs.length}</span>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="rn-list">
        <AnimatePresence>
          {jobs.map((j, i) => (
            <PostCard key={j.id} job={j} index={i} fresh={!seen.has(j.id)} />
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
