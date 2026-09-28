// /seller on a laptop or the projector: estimate vs sold vs earned, the items grid, proof notices,
// tracker + earnings tabs, slow sellers, and "Offload a new pile" (webcam) in place.
import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowUpRight, Plus, Sparkles, Wallet } from 'lucide-react';
import { EASE, Reveal, Stagger, rise } from '../../components/motion';
import { Button, EmptyState, ErrorNote, Loading, PageShell } from '../../components/ui';
import { formatMoney } from '../../lib/money';
import { ledgerOfPickup, sellerEarned, soldTotal } from '../../lib/selectors';
import { useAppState, useMutation } from '../../lib/state';
import { api } from '../../lib/api';
import type { AppState, Item, Job, Pickup } from '../../types';
import { Count } from './Count';
import { plural, possessive } from './derive';
import { DetailsFields, FilmPromise, Tips, useDetails } from './Details';
import { Earnings } from './Earnings';
import { Estimate } from './Estimate';
import { Film } from './Film';
import { GainFigure } from './Gain';
import { Pieces } from './Pieces';
import { LineTabs, tabSlide, useDirection, type TabOption } from './Tabs';
import { Tracker, useProofSent } from './Tracker';
import { useSellerPickup } from './usePickup';

type DeskTab = 'pieces' | 'tracker' | 'earnings';
const TABS: TabOption<DeskTab>[] = [
  { id: 'pieces', label: 'My pieces' },
  { id: 'tracker', label: 'Pickup tracker' },
  { id: 'earnings', label: 'My earnings' },
];

function Stats({ state, pickup, items }: { state: AppState; pickup: Pickup; items: Item[] }) {
  const n = items.length || pickup.preview.length;
  const sold = soldTotal(state, pickup.id);
  const earned = sellerEarned(state, pickup.id);
  const sales = ledgerOfPickup(state, pickup.id).length;
  return (
    <Stagger className="stats sl-stats" gap={0.08}>
      <motion.div variants={rise}>
        <span>Your pile's estimate</span>
        <strong>
          <Count className="sl-n" value={pickup.estimate_low} startFrom={0} />
          <span className="sl-dash" aria-hidden>
            –
          </span>
          <span className="sr-only"> to </span>
          <Count className="sl-n" value={pickup.estimate_high} startFrom={0} />
        </strong>
        <small>{plural(n, 'piece')} with potential</small>
      </motion.div>
      <motion.div variants={rise}>
        <span>Sold so far</span>
        <strong>
          <Count className="sl-n" value={sold} startFrom={0} />
        </strong>
        <small>{sales ? `${plural(sales, 'piece')} found a new home` : 'Nothing sold yet'}</small>
      </motion.div>
      <motion.div variants={rise} className="accent-stat">
        <span>Your earnings</span>
        <strong>
          <GainFigure value={earned}>
            <Count className="sl-n" value={earned} startFrom={0} />
          </GainFigure>
        </strong>
        <small>
          <Wallet size={15} aria-hidden /> Your 70% of every sale
        </small>
      </motion.div>
    </Stagger>
  );
}

function ProofNotices({ items, onOpen }: { items: Item[]; onOpen: () => void }) {
  const asks = items.filter((i) => i.proof_request);
  return (
    <AnimatePresence initial={false}>
      {asks.map((i) => (
        <motion.div
          key={i.id}
          className="notice sl-notice"
          layout
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
        >
          <span className="icon-disc">
            <Sparkles size={22} aria-hidden />
          </span>
          <div>
            <strong>A little more about your {i.label}?</strong>
            <p>{i.proof_request}</p>
          </div>
          <button className="text-link" onClick={onOpen}>
            Add photos <ArrowUpRight size={18} aria-hidden />
          </button>
        </motion.div>
      ))}
    </AnimatePresence>
  );
}

// A real price drop: it sets the seller's own price (POST /api/items/:id/ask), which re-prices the listing
// (and Shopify, when it's connected) straight away. Only pieces still waiting for a buyer are offered.
const dropped = (list: number) => Math.max(100, Math.round((list * 0.85) / 100) * 100);

function SlowSellers({ items }: { items: Item[] }) {
  const waiting = items.filter((i) => i.status === 'listed').slice(0, 3);
  return (
    <Reveal className="slow-sellers sl-slow">
      <div className="sl-slow-copy">
        <h3>Want one gone sooner?</h3>
        <p>A lower price usually does it. The listing updates straight away and you still keep 70%.</p>
      </div>
      {waiting.length ? (
        <motion.ul className="sl-slow-list" layout>
          <AnimatePresence initial={false}>
            {waiting.map((i) => (
              <SlowRow key={i.id} item={i} />
            ))}
          </AnimatePresence>
        </motion.ul>
      ) : (
        <p className="sl-slow-none">Nothing waiting on a buyer right now.</p>
      )}
    </Reveal>
  );
}

function SlowRow({ item }: { item: Item }) {
  const { upsert } = useAppState();
  const m = useMutation(api.setAsk);
  const lower = dropped(item.list_price);
  const drop = async () => {
    const out = await m.run(item.id, lower);
    if (out) upsert('items', out);
  };
  return (
    <motion.li layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.35, ease: EASE }}>
      <span>
        {item.label}
        <small>
          Listed at <Count value={item.list_price} />
          {m.error ? <em className="sl-slow-error" role="alert"> · {m.error}</em> : null}
        </small>
      </span>
      <Button variant="outline" pending={m.pending} disabled={lower >= item.list_price} onClick={drop}>
        Drop to {formatMoney(lower)}
      </Button>
    </motion.li>
  );
}

function DesktopFilm({ onClose, onDone }: { onClose: () => void; onDone: (p: Pickup) => void }) {
  const d = useDetails();
  const addressRef = useRef<HTMLInputElement>(null);
  const ready = d.details.address.trim().length >= 6;
  return (
    <Film
      layout="desktop"
      details={d.details}
      canRecord={ready}
      onBlocked={() => {
        d.commit();
        addressRef.current?.focus();
      }}
      onClose={onClose}
      onDone={(p) => {
        d.commit();
        onDone(p);
      }}
      aside={(f) => (
        <>
          <span className="eyebrow">ONE VIDEO. ZERO LISTINGS.</span>
          <h2>
            Show us
            <br />
            what you've got.
          </h2>
          <p>Lay your clothes out, hit record and talk us through each piece. We'll tell you what to expect.</p>
          <DetailsFields d={d} idPrefix="desk" ref={addressRef} locked={f.phase === 'recording' || f.phase === 'thinking'} />
          <Tips compact />
          <FilmPromise />
        </>
      )}
    />
  );
}

function Dashboard({
  state,
  pickup,
  items,
  job,
  isMine,
  onBooked,
  onFilm,
  onSeeLatest,
}: {
  state: AppState;
  pickup: Pickup;
  items: Item[];
  job: Job | null;
  isMine: boolean;
  onBooked: (j: Job) => void;
  onFilm: () => void;
  onSeeLatest?: () => void;
}) {
  const [tab, setTab] = useState<DeskTab>('pieces');
  const dir = useDirection(tab, (t) => TABS.findIndex((o) => o.id === t));
  const proof = useProofSent();
  const unbooked = pickup.status === 'estimated' && !job;
  const n = items.length || pickup.preview.length;
  return (
    <>
      <AnimatePresence>
        {unbooked ? (
          <motion.div key="estimate" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.45, ease: EASE }}>
            <Estimate pickup={pickup} items={items} onBooked={onBooked} onFilmAgain={isMine ? onFilm : undefined} desk />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <Stats state={state} pickup={pickup} items={items} />
      <LineTabs
        options={TABS}
        value={tab}
        onChange={setTab}
        label="Your pile"
        aside={
          <>
            {`${possessive(pickup.seller_name)} pile · ${plural(n, 'piece')}${isMine ? '' : ' · latest from the live demo'}`}
            {onSeeLatest ? (
              <button type="button" className="text-link sl-see-latest" onClick={onSeeLatest}>
                See the latest pile <ArrowUpRight size={14} aria-hidden />
              </button>
            ) : null}
          </>
        }
      />
      {tab !== 'tracker' ? <ProofNotices items={items} onOpen={() => setTab('tracker')} /> : null}
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
          {tab === 'pieces' ? (
            <>
              <Pieces state={state} pickup={pickup} items={items} />
              <SlowSellers items={items} />
            </>
          ) : tab === 'tracker' ? (
            <Tracker state={state} pickup={pickup} items={items} job={job} sent={proof.sent} onSent={proof.onSent} desk />
          ) : (
            <Earnings state={state} pickup={pickup} items={items} />
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

export function DesktopSeller() {
  const sp = useSellerPickup({ fallbackToLatest: true });
  const { refresh } = useAppState();
  const [filming, setFilming] = useState(false);
  const { state, pickup } = sp;

  const newPile = (
    <Button onClick={() => setFilming(true)}>
      Offload a new pile <Plus size={19} aria-hidden />
    </Button>
  );
  const action = filming ? (
    <Button variant="outline" onClick={() => setFilming(false)}>
      <ArrowLeft size={18} aria-hidden /> Back to your wardrobe
    </Button>
  ) : (
    newPile
  );

  let body;
  if (filming) {
    body = (
      <DesktopFilm
        onClose={() => setFilming(false)}
        onDone={(p) => {
          sp.adopt(p);
          setFilming(false);
        }}
      />
    );
  } else if (!state) {
    body = (
      <>
        {sp.error ? <ErrorNote onRetry={() => refresh()}>{sp.error}</ErrorNote> : null}
        <Loading label={pickup ? 'Catching up on your pile…' : 'Loading your wardrobe…'} />
      </>
    );
  } else if (!pickup) {
    body = (
      <EmptyState title="Nothing on the move yet" action={newPile}>
        Film your pile once and we'll handle the rest: the estimate, the pickup, the listings and the buyers.
      </EmptyState>
    );
  } else {
    // This laptop filmed an older pile of its own: offer the live demo's latest too.
    const latest = sp.isMine && sp.latest && sp.latest.id !== pickup.id ? sp.latest : null;
    body = (
      <Dashboard
        key={pickup.id}
        state={state}
        pickup={pickup}
        items={sp.items}
        job={sp.job}
        isMine={sp.isMine}
        onBooked={sp.markBooked}
        onFilm={() => setFilming(true)}
        onSeeLatest={latest ? () => sp.follow(latest.id) : undefined}
      />
    );
  }

  return (
    <PageShell
      kicker="A LITTLE SPACE LOOKS GOOD ON YOU"
      title={filming ? 'A new pile, a fresh start.' : 'Your wardrobe, moving on.'}
      subtitle={filming ? 'One quick video. We take it from there.' : "You've done your bit. We'll take it from here."}
      action={action}
    >
      <AnimatePresence mode="wait">
        <motion.div key={filming ? 'film' : 'dash'} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4, ease: EASE }}>
          {body}
        </motion.div>
      </AnimatePresence>
    </PageShell>
  );
}
