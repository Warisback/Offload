// /runner on a laptop or the projector: big numbers, the job list in tabs, and the same guided flow in two columns.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Camera, Check, CircleCheck, MapPin, Package, ShieldCheck, Store, Truck, Wallet } from 'lucide-react';
import type { AppState, Job } from '../../types';
import { useAppState } from '../../lib/state';
import { formatMoney } from '../../lib/money';
import { Chip, EmptyState, Loading, PageShell } from '../../components/ui';
import { EASE, SPRING } from '../../components/motion';
import { area, plural, street } from './copy';
import { deriveRunner, jobInfo, postItemLabel, type RunnerView } from './derive';
import { useRunner } from './session';
import { NameGate } from './NameGate';
import { ActiveJob } from './ActiveJob';
import { PickupJobCard, PostList, TakenCard } from './JobCards';
import { Celebration } from './Celebration';
import { Money } from './Money';

type Tab = 'open' | 'accepted' | 'done';
const TABS: { key: Tab; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'done', label: 'Done' },
];

function Stats({ view, state }: { view: RunnerView; state: AppState }) {
  const collected = view.done.reduce((n, j) => n + jobInfo(state, j).count, 0);
  const next: Job | null = view.active || view.open[0] || null;
  const nextCount = next ? jobInfo(state, next).count : 0;
  return (
    <div className="stats rn-stats">
      <div className="accent-stat">
        <span>Earned today</span>
        <strong>
          <Money value={view.earned} />
        </strong>
        <small>
          <Wallet size={15} aria-hidden /> {collected ? `${plural(collected, 'piece')} given a second chance` : 'Your first pickup pays on collection'}
        </small>
      </div>
      <div>
        <span>This week</span>
        <strong>
          <Money value={view.earned} />
        </strong>
        <small>All your offload jobs so far</small>
      </div>
      <div className={next ? 'rn-next-stat' : ''}>
        <span>{view.active ? 'Your pickup now' : 'Your next pickup'}</span>
        <strong className="text-stat">{next ? area(next.address) || street(next.address) : 'All clear'}</strong>
        <small>
          <MapPin size={14} aria-hidden /> {next ? `${plural(nextCount, 'piece')} · ${formatMoney(next.pay)}` : 'We’ll show new ones here'}
        </small>
      </div>
    </div>
  );
}

function Tabs({ tab, counts, onTab }: { tab: Tab; counts: Record<Tab, number>; onTab: (t: Tab) => void }) {
  return (
    <div className="tab-row rn-tabs">
      <div role="tablist" aria-label="Jobs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`rn-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="rn-tabpanel"
            className={`rn-tab ${tab === t.key ? 'is-on' : ''}`}
            onClick={() => onTab(t.key)}
          >
            {t.label}
            <span className="rn-tab-count">{counts[t.key]}</span>
            {tab === t.key ? <motion.span layoutId="rn-tab-line" className="rn-tab-line" transition={SPRING} /> : null}
          </button>
        ))}
      </div>
      <span className="muted">Local jobs, lighter wardrobes.</span>
    </div>
  );
}

function Aside() {
  const steps = [
    { icon: Package, text: 'Accept a pickup' },
    { icon: Camera, text: 'Photograph each piece' },
    { icon: Store, text: 'Hand over, we list it' },
    { icon: Truck, text: 'Post it when it sells' },
  ];
  return (
    <aside className="runner-aside rn-aside">
      <div className="route-art">
        <MapPin size={39} aria-hidden />
        <span>
          LOCAL STOPS.
          <br />
          BIG DIFFERENCE.
        </span>
        <ArrowUpRight size={50} aria-hidden />
      </div>
      <h3>
        Less landfill.
        <br />
        More local good.
      </h3>
      <p>You’re the person who gets good clothes moving again. One doorstep at a time.</p>
      <ol className="rn-aside-steps">
        {steps.map(({ icon: Icon, text }) => (
          <li key={text}>
            <span aria-hidden>
              <Icon size={16} />
            </span>
            {text}
          </li>
        ))}
      </ol>
    </aside>
  );
}

function DonePanel({ view, state }: { view: RunnerView; state: AppState }) {
  const collected = view.done.reduce((n, j) => n + jobInfo(state, j).count, 0);
  return (
    <div className="rn-list">
      <motion.div className="panel rn-done-panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
        <CircleCheck size={32} aria-hidden />
        <h2>A good day’s work.</h2>
        <p>
          {plural(collected, 'piece')} collected. {formatMoney(view.earned)} earned.
          {view.postsDone.length ? ` ${view.postsDone.length} posted to new homes.` : ''}
        </p>
      </motion.div>
      {view.done.map((j, i) => (
        <PickupJobCard key={j.id} job={j} variant="done" index={i + 1} />
      ))}
      {view.postsDone.length ? (
        <ul className="rn-posted-list">
          {view.postsDone.map((j) => (
            <li key={j.id}>
              <Check size={16} aria-hidden /> Posted {postItemLabel(state, j)}
              <small>{j.address}</small>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function RunnerDesktop() {
  const { state } = useAppState();
  const s = useRunner();
  const [tabPick, setTab] = useState<Tab | null>(null);
  const [flowOpen, setFlowOpen] = useState(false);
  const view = state && s.name ? deriveRunner(state, s.name, s.flow.resultId, s.preferred) : null;
  const activeId = view?.active?.id ?? null;

  // Open the guided flow once if a pickup is already underway (e.g. a phone rotated into this layout mid-pickup).
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!activeId) setFlowOpen(false);
    else if (!autoOpened.current) {
      autoOpened.current = true;
      setFlowOpen(true);
    }
  }, [activeId]);

  const tab: Tab = tabPick ?? (view?.active ? 'accepted' : 'open');
  const firstOpen = state?.jobs.find((j) => j.type === 'pickup' && j.status === 'open');
  const teaser = state && firstOpen ? { pay: firstOpen.pay, count: jobInfo(state, firstOpen).count } : null;

  const openPosts = view ? view.posts.filter((j) => j.status === 'open') : [];
  const myPosts = view ? view.posts.filter((j) => j.status !== 'open') : [];
  const counts: Record<Tab, number> = view
    ? {
        open: view.open.length + openPosts.length,
        accepted: (view.active ? 1 : 0) + view.otherActive.length + myPosts.length,
        done: view.done.length + view.postsDone.length,
      }
    : { open: 0, accepted: 0, done: 0 };

  const onAccepted = () => {
    setTab('accepted');
    setFlowOpen(true);
  };

  return (
    <PageShell
      kicker="GOOD WORK. CLOSE TO HOME."
      title={s.name ? `Hey ${s.name}. Let’s get moving.` : 'Be the runner.'}
      subtitle="A few good pieces. A few local stops. A little extra earned."
      action={
        s.name ? (
          <div className="rn-desk-action">
            <Chip tone="green">
              <ShieldCheck size={15} aria-hidden /> Verified runner
            </Chip>
            {!view?.active ? (
              <button type="button" className="text-link" onClick={() => s.setName(null)}>
                Not {s.name}?
              </button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {!s.name ? (
        <div className="rn-desk-gate">
          <NameGate heading="h2" onDone={s.setName} teaser={teaser} />
        </div>
      ) : !state || !view ? (
        <Loading label="Finding pickups near you…" />
      ) : (
        <>
          <Stats view={view} state={state} />
          <AnimatePresence>
            {s.celebrate && !view.active ? (
              <div className="rn-desk-celebrate" key={s.celebrate.jobId}>
                <Celebration data={s.celebrate} name={s.name} earned={view.earned} onDone={() => s.setCelebrate(null)} />
              </div>
            ) : null}
          </AnimatePresence>
          {flowOpen && view.active ? (
            <div className="rn-desk-flow">
              <ActiveJob key={view.active.id} job={view.active} onClose={() => setFlowOpen(false)} />
              {myPosts.length ? (
                <div className="rn-posts">
                  <PostList jobs={myPosts} />
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <Tabs tab={tab} counts={counts} onTab={setTab} />
              <div className="runner-layout rn-desk-layout">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={tab}
                    id="rn-tabpanel"
                    role="tabpanel"
                    aria-labelledby={`rn-tab-${tab}`}
                    className="rn-tabpanel"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.3, ease: EASE }}
                  >
                    {tab === 'open' ? (
                      <div className="rn-list">
                        <AnimatePresence>
                          {s.taken.map((j, i) => (
                            <TakenCard key={`taken-${j.id}`} job={j} index={i} />
                          ))}
                          {view.open.map((j, i) => (
                            <PickupJobCard key={j.id} job={j} variant="open" index={i} highlight={i === 0 && !view.active} onAccepted={onAccepted} />
                          ))}
                        </AnimatePresence>
                        {openPosts.length ? (
                          <div className="rn-posts">
                            <PostList jobs={openPosts} />
                          </div>
                        ) : null}
                        {!view.open.length && !openPosts.length ? (
                          <EmptyState title="No pickups nearby right now.">We’ll show new ones here.</EmptyState>
                        ) : null}
                      </div>
                    ) : tab === 'accepted' ? (
                      <div className="rn-list">
                        {view.active ? <PickupJobCard key={view.active.id} job={view.active} variant="active" highlight onOpen={() => setFlowOpen(true)} /> : null}
                        {view.otherActive.map((j, i) => (
                          <PickupJobCard key={j.id} job={j} variant="queued" index={i + 1} onOpen={() => setFlowOpen(true)} />
                        ))}
                        <div className="rn-posts">
                          <PostList jobs={myPosts} />
                        </div>
                        {!view.active && !view.otherActive.length && !myPosts.length ? (
                          <EmptyState title="Nothing on your list yet.">Accept a pickup from Open and it lands here.</EmptyState>
                        ) : null}
                      </div>
                    ) : view.done.length || view.postsDone.length ? (
                      <DonePanel view={view} state={state} />
                    ) : (
                      <EmptyState title="Nothing done yet today.">Finished pickups and posted parcels show up here.</EmptyState>
                    )}
                  </motion.div>
                </AnimatePresence>
                <Aside />
              </div>
            </>
          )}
        </>
      )}
    </PageShell>
  );
}
