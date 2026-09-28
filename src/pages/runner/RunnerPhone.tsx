// /runner on a phone: what judges see after scanning the QR. Earnings pinned at the top, one clear thing to do at a time.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Camera, CircleCheck, Package, ShieldCheck, Store } from 'lucide-react';
import { useAppState } from '../../lib/state';
import { USE_MOCK } from '../../lib/config';
import { formatMoney } from '../../lib/money';
import { EmptyState, ErrorNote, Footer, Header, Loading, SyncBanner } from '../../components/ui';
import { EASE } from '../../components/motion';
import { initial, plural, scrollToTop } from './copy';
import { deriveRunner, jobInfo, type RunnerView } from './derive';
import { useRunner } from './session';
import { NameGate } from './NameGate';
import { ActiveJob } from './ActiveJob';
import { PickupJobCard, PostList, TakenCard } from './JobCards';
import { Celebration } from './Celebration';
import { Money } from './Money';

// earned is null until the first poll, so a returning runner doesn't get a "+£36" on page load.
function TopBar({ name, earned, canChange, onChangeName }: { name: string; earned: number | null; canChange: boolean; onChangeName: () => void }) {
  const prev = useRef<number | null>(null);
  const [bump, setBump] = useState<{ key: number; delta: number } | null>(null);
  useEffect(() => {
    if (earned == null) return;
    if (prev.current != null && earned > prev.current) setBump({ key: Date.now(), delta: earned - prev.current });
    prev.current = earned;
  }, [earned]);
  const shown = earned ?? 0;
  return (
    <div className="rn-top">
      <span className="rn-avatar" aria-hidden>
        {initial(name)}
      </span>
      <div className="rn-top-who">
        <h1 tabIndex={-1}>Hi {name}</h1>
        <div className="rn-top-meta">
          <span className="rn-verified-chip">
            <ShieldCheck size={13} aria-hidden /> Verified runner
          </span>
          {canChange ? (
            <button type="button" className="rn-not-me" onClick={onChangeName}>
              Not you?
            </button>
          ) : null}
        </div>
      </div>
      <div className="rn-top-earned">
        <small>Earned today</small>
        <strong>
          <span aria-hidden>
            <Money value={shown} />
          </span>
          <span className="sr-only">{formatMoney(shown)}</span>
        </strong>
        <AnimatePresence>
          {bump ? (
            <motion.span
              key={bump.key}
              className="rn-earn-plus"
              initial={{ opacity: 0, y: 8, scale: 0.9 }}
              animate={{ opacity: [0, 1, 1, 0], y: [8, 0, 0, -6], scale: [0.9, 1, 1, 1] }}
              transition={{ duration: 2, ease: EASE, times: [0, 0.15, 0.75, 1] }}
              onAnimationComplete={() => setBump(null)}
              aria-hidden
            >
              +{formatMoney(bump.delta)}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

const HOW = [
  { icon: Package, text: 'Accept' },
  { icon: Camera, text: 'Photograph' },
  { icon: Store, text: 'Hand over' },
];

function HowItWorks() {
  return (
    <ol className="rn-how" aria-label="How it works">
      {HOW.map(({ icon: Icon, text }, i) => (
        <motion.li key={text} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.08, duration: 0.4, ease: EASE }}>
          <span aria-hidden>
            <Icon size={16} />
          </span>
          {text}
        </motion.li>
      ))}
    </ol>
  );
}

function DoneSummary({ view }: { view: RunnerView }) {
  const { state } = useAppState();
  if (!state || (!view.done.length && !view.postsDone.length)) return null;
  const items = view.done.reduce((n, j) => n + jobInfo(state, j).count, 0);
  return (
    <motion.div className="rn-done" layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <CircleCheck size={20} aria-hidden />
      <div>
        <strong>Done today</strong>
        <small>
          {view.done.length ? `${plural(view.done.length, 'pickup')}, ${plural(items, 'item')} collected` : 'No pickups yet'}
          {view.postsDone.length ? ` · ${view.postsDone.length} posted` : ''}
        </small>
      </div>
      <strong className="rn-done-money">{formatMoney(view.earned)}</strong>
    </motion.div>
  );
}

function PhoneBody({ view }: { view: RunnerView }) {
  const s = useRunner();

  if (view.active) {
    // Open pickups stay reachable below: accepting one makes it the pickup on screen (see deriveRunner's preferred).
    return (
      <div className="rn-stack">
        <ActiveJob key={view.active.id} job={view.active} />
        <div className="rn-posts">
          <PostList jobs={view.posts} />
        </div>
        {view.otherActive.length ? (
          <section className="rn-section" aria-label="Your other pickups">
            <div className="rn-section-head">
              <span className="eyebrow">ALSO ON YOUR LIST</span>
              <span className="rn-count-pill">{view.otherActive.length}</span>
            </div>
            <div className="rn-list">
              {view.otherActive.map((j, i) => (
                <PickupJobCard key={j.id} job={j} variant="queued" index={i} onOpen={scrollToTop} />
              ))}
            </div>
          </section>
        ) : null}
        {view.open.length || s.taken.length ? (
          <section className="rn-section" aria-label="More pickups near you">
            <div className="rn-section-head">
              <span className="eyebrow">MORE PICKUPS NEAR YOU</span>
              {view.open.length ? <span className="rn-count-pill">{view.open.length}</span> : null}
            </div>
            <div className="rn-list">
              <AnimatePresence>
                {s.taken.map((j, i) => (
                  <TakenCard key={`taken-${j.id}`} job={j} index={i} />
                ))}
                {view.open.map((j, i) => (
                  <PickupJobCard key={j.id} job={j} variant="open" index={i} onAccepted={scrollToTop} />
                ))}
              </AnimatePresence>
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  const firstTime = !view.done.length && !view.postsDone.length && !s.celebrate;
  return (
    <div className="rn-stack">
      <AnimatePresence>
        {s.celebrate ? <Celebration key={s.celebrate.jobId} data={s.celebrate} name={s.name || ''} earned={view.earned} onDone={() => s.setCelebrate(null)} /> : null}
      </AnimatePresence>
      <div className="rn-posts">
        <PostList jobs={view.posts} />
      </div>
      <section className="rn-section" aria-label="Pickups near you">
        <div className="rn-section-head">
          <span className="eyebrow">PICKUPS NEAR YOU</span>
          {view.open.length ? <span className="rn-count-pill">{view.open.length}</span> : null}
        </div>
        {firstTime && view.open.length ? <HowItWorks /> : null}
        <div className="rn-list">
          <AnimatePresence>
            {s.taken.map((j, i) => (
              <TakenCard key={`taken-${j.id}`} job={j} index={i} />
            ))}
            {view.open.map((j, i) => (
              <PickupJobCard key={j.id} job={j} variant="open" index={i} highlight={i === 0} onAccepted={scrollToTop} />
            ))}
          </AnimatePresence>
        </div>
        {!view.open.length ? (
          <EmptyState
            title="No pickups nearby right now."
            action={
              <Link className="text-link" to="/live">
                Meanwhile, watch the live room <ArrowUpRight size={15} aria-hidden />
              </Link>
            }
          >
            We’ll show new ones here.
          </EmptyState>
        ) : null}
      </section>
      <DoneSummary view={view} />
    </div>
  );
}

export function RunnerPhone() {
  const { state, error, refresh } = useAppState();
  const s = useRunner();
  const view = state && s.name ? deriveRunner(state, s.name, s.flow.resultId, s.preferred) : null;
  const firstOpen = state?.jobs.find((j) => j.type === 'pickup' && j.status === 'open');
  const teaser = state && firstOpen ? { pay: firstOpen.pay, count: jobInfo(state, firstOpen).count } : null;

  return (
    <>
      <Header />
      <main className="rn-phone" id="main">
        {!s.name ? (
          <NameGate onDone={s.setName} teaser={teaser} />
        ) : (
          <>
            <TopBar name={s.name} earned={view ? view.earned : null} canChange={!view?.active} onChangeName={() => s.setName(null)} />
            <SyncBanner />
            {!state || !view ? (
              USE_MOCK && error ? (
                <ErrorNote onRetry={() => refresh()}>{error}</ErrorNote>
              ) : (
                <Loading label={error ? 'Still trying to reach offload…' : 'Finding pickups near you…'} />
              )
            ) : (
              <PhoneBody view={view} />
            )}
          </>
        )}
      </main>
      {USE_MOCK ? <div className="prototype-note">Demo data · running without the backend</div> : null}
      <Footer />
    </>
  );
}
