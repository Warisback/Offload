// /seller on a phone: intro -> film (full screen) -> estimate -> tracker / earnings / pieces.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Camera, Check, Plus, ScanLine, Sparkles } from 'lucide-react';
import { EASE } from '../../components/motion';
import { Button, ErrorNote, Header, Loading, SyncBanner } from '../../components/ui';
import { sellerEarned } from '../../lib/selectors';
import { useAppState } from '../../lib/state';
import type { Job, Pickup } from '../../types';
import { Count } from './Count';
import { possessive, plural, statusNow, trackerSteps } from './derive';
import { DetailsFields, FilmPromise, Tips, useDetails, type Details } from './Details';
import { Earnings } from './Earnings';
import { Estimate } from './Estimate';
import { Film } from './Film';
import { GainFigure } from './Gain';
import { Pieces } from './Pieces';
import { SegTabs, tabSlide, useDirection, type TabOption } from './Tabs';
import { Tracker, useProofSent } from './Tracker';
import { useSellerPickup } from './usePickup';

type View = 'loading' | 'intro' | 'estimate' | 'follow';
const ORDER: Record<View, number> = { loading: 0, intro: 0, estimate: 1, follow: 2 };

type PhoneTab = 'tracker' | 'earnings' | 'pieces';
const TABS: TabOption<PhoneTab>[] = [
  { id: 'tracker', label: 'Tracker' },
  { id: 'earnings', label: 'Earnings' },
  { id: 'pieces', label: 'Pieces' },
];

const steps = {
  enter: (d: number) => ({ opacity: 0, x: d * 56 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.5, ease: EASE } },
  exit: (d: number) => ({ opacity: 0, x: d * -56, transition: { duration: 0.28, ease: EASE } }),
};

function IntroArt() {
  return (
    <div className="step-visual lavender sl-intro-art" aria-hidden>
      <motion.div className="sl-art-cam" animate={{ y: [0, -6, 0] }} transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}>
        <div className="mini-camera">
          <ScanLine size={52} strokeWidth={1} />
          <span>Tell us its story.</span>
          <span className="mini-record" />
        </div>
      </motion.div>
      <motion.span className="sl-art-chip" initial={{ opacity: 0, x: -14, rotate: -4 }} animate={{ opacity: 1, x: 0, rotate: -4 }} transition={{ delay: 0.35, duration: 0.6, ease: EASE }}>
        <Sparkles size={13} /> Show me the label
      </motion.span>
      <motion.span className="sl-art-chip is-right" initial={{ opacity: 0, x: 14, rotate: 3 }} animate={{ opacity: 1, x: 0, rotate: 3 }} transition={{ delay: 0.55, duration: 0.6, ease: EASE }}>
        <span className="sl-art-rec" /> Talk us through it
      </motion.span>
    </div>
  );
}

function Intro({ d, onStart, onBack, onSeeLatest }: { d: Details; onStart: () => void; onBack?: () => void; onSeeLatest?: () => void }) {
  const addressRef = useRef<HTMLInputElement>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (d.commit()) onStart();
    else addressRef.current?.focus();
  };
  return (
    <section className="sl-intro">
      <IntroArt />
      <span className="eyebrow">ONE VIDEO. ZERO LISTINGS.</span>
      <h1 tabIndex={-1}>Show us what you've got.</h1>
      <p className="sl-lede">Lay your clothes out, take a quick video and talk us through each piece. We'll tell you what to expect, then a runner collects it.</p>
      <Tips />
      <form onSubmit={submit} noValidate className="sl-intro-form">
        <DetailsFields d={d} idPrefix="ph" ref={addressRef} />
        <Button type="submit" className="sl-cta">
          Start filming <Camera size={20} aria-hidden />
        </Button>
        <FilmPromise />
      </form>
      <div className="sl-quiet-links">
        {onBack ? (
          <button type="button" className="text-link sl-link-quiet" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden /> Back to my pile
          </button>
        ) : null}
        {onSeeLatest ? (
          <button type="button" className="text-link sl-link-quiet" onClick={onSeeLatest}>
            Following a pile from the live demo? <span className="sl-link-em">See the latest</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}

function Follow({ sp, onNew, onSeeLatest }: { sp: ReturnType<typeof useSellerPickup>; onNew: () => void; onSeeLatest?: () => void }) {
  const [tab, setTab] = useState<PhoneTab>('tracker');
  const dir = useDirection(tab, (t) => TABS.findIndex((o) => o.id === t));
  const proof = useProofSent();
  const { state, pickup, items, job } = sp;
  if (!state || !pickup) return <Loading label="Catching up on your pile…" />;
  const status = statusNow(trackerSteps(state, pickup, job));
  const n = items.length || pickup.preview.length;
  const earned = sellerEarned(state, pickup.id);
  return (
    <section className="sl-follow">
      <span className="eyebrow">
        {possessive(pickup.seller_name).toUpperCase()} PILE · {plural(n, 'piece').toUpperCase()}
      </span>
      <h1 tabIndex={-1}>Your pile, moving on.</h1>
      <div className="sl-status-wrap" role="status">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={status.text} className="sl-status" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: EASE }}>
            {status.live ? <span className="live-dot sl-pulse" aria-hidden /> : <Check size={15} aria-hidden />}
            {status.text}
          </motion.p>
        </AnimatePresence>
      </div>
      <div className="sl-earned-mini">
        <span>Earned so far</span>
        <strong>
          <GainFigure value={earned}>
            <Count value={earned} startFrom={0} />
          </GainFigure>
        </strong>
      </div>
      <SegTabs options={TABS} value={tab} onChange={setTab} label="Your pile" />
      <AnimatePresence mode="wait" custom={dir}>
        <motion.div
          key={tab}
          role="tabpanel"
          id={`sl-panel-${tab}`}
          aria-labelledby={`sl-tab-${tab}`}
          custom={dir}
          variants={tabSlide}
          initial="enter"
          animate="center"
          exit="exit"
        >
          {tab === 'tracker' ? (
            <Tracker state={state} pickup={pickup} items={items} job={job} sent={proof.sent} onSent={proof.onSent} />
          ) : tab === 'earnings' ? (
            <Earnings state={state} pickup={pickup} items={items} />
          ) : (
            <Pieces state={state} pickup={pickup} items={items} />
          )}
        </motion.div>
      </AnimatePresence>
      <div className="sl-follow-foot">
        <Button variant="outline" className="sl-cta" onClick={onNew}>
          Offload another pile <Plus size={19} aria-hidden />
        </Button>
        {onSeeLatest ? (
          <button type="button" className="text-link sl-link-quiet" onClick={onSeeLatest}>
            Following a pile from the live demo? <span className="sl-link-em">See the latest</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function PhoneSeller() {
  const sp = useSellerPickup({ fallbackToLatest: false });
  const d = useDetails();
  const { refresh } = useAppState();
  const [filming, setFilming] = useState(false);
  const [fresh, setFresh] = useState(false); // asked to offload another pile

  const view: View = fresh
    ? 'intro'
    : sp.pickup
      ? sp.pickup.status === 'estimated' && !sp.job
        ? 'estimate'
        : 'follow'
      : sp.resolving
        ? 'loading'
        : 'intro';
  const dir = useDirection(view, (v) => ORDER[v]);

  // New step: back to the top, and (after the first) move focus to its heading.
  const mountedView = useRef(view);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mountedView.current === view) return;
    mountedView.current = view;
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [view]);

  const latest = sp.latest && sp.latest.id !== sp.pickup?.id ? sp.latest : null;
  const seeLatest = latest
    ? () => {
        sp.follow(latest.id);
        setFresh(false);
      }
    : undefined;

  const onDone = (p: Pickup) => {
    sp.adopt(p);
    setFresh(false);
    setFilming(false);
  };
  const onBooked = (job: Job) => sp.markBooked(job);
  // POST /api/pickups needs an address. Someone who arrived by following the live demo's pile may never
  // have filled it in: send them to the form (which says what's missing) instead of filming blind.
  const filmAgain = () => {
    if (d.commit()) setFilming(true);
    else setFresh(true);
  };

  let content;
  if (view === 'loading') {
    content = (
      <section className="sl-loading">
        <h1 className="sr-only" tabIndex={-1}>
          Your pile
        </h1>
        <Loading label="Finding your pile…" />
        {sp.error ? <ErrorNote onRetry={() => refresh()}>{sp.error}</ErrorNote> : null}
        <button type="button" className="text-link sl-link-quiet" onClick={() => setFresh(true)}>
          Start a new pile instead
        </button>
      </section>
    );
  } else if (view === 'intro') {
    content = <Intro d={d} onStart={() => setFilming(true)} onBack={fresh && sp.pickup ? () => setFresh(false) : undefined} onSeeLatest={seeLatest} />;
  } else if (view === 'estimate' && sp.pickup) {
    content = <Estimate pickup={sp.pickup} items={sp.items} onBooked={onBooked} onFilmAgain={filmAgain} />;
  } else {
    content = <Follow sp={sp} onNew={() => setFresh(true)} onSeeLatest={seeLatest} />;
  }

  return (
    <>
      {/* While the full-screen camera is up, everything behind it is out of reach (focus and screen readers). */}
      <div className="sl-phone-page" inert={filming}>
        <Header />
        <main className="sl-phone" id="main">
          <SyncBanner />
          {/* The first step fades in (direction 0); later steps slide the way you're going. */}
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={view}
              ref={box}
              custom={dir}
              variants={steps}
              initial="enter"
              animate="center"
              exit="exit"
              onAnimationComplete={(def) => {
                if (def === 'center' && mountedView.current === view && document.activeElement === document.body) {
                  box.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
                }
              }}
            >
              {content}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <AnimatePresence>
        {filming ? <Film key="film" layout="phone" details={d.details} onClose={() => setFilming(false)} onDone={onDone} /> : null}
      </AnimatePresence>
    </>
  );
}
