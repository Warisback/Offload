// /offer/:itemId: the buyer page. An editorial product page with one plain, clearly labelled HTML form
// (the Grok Bot shopping agent drives it in a real browser), and honest replies straight from the backend's Offer rows.
import './offer.css';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, motion, useAnimate, useReducedMotion, type PanInfo, type Variants } from 'motion/react';
import {
  ArrowLeft,
  ArrowUpRight,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  HandCoins,
  ImageOff,
  Loader2,
  MessageCircle,
  Quote,
  ShieldCheck,
  Shirt,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { api } from '../lib/api';
import { SHOP_PASSWORD, USE_MOCK } from '../lib/config';
import { formatMoney, parsePounds } from '../lib/money';
import { GRADE_LABEL, isOnSale, isSold, itemById, offersFor } from '../lib/selectors';
import { useAppState, useMutation } from '../lib/state';
import { Button, ButtonLink, Chip, ErrorNote, Footer, Header, SyncBanner, useIsPhone, useTitle } from '../components/ui';
import { CountUp, EASE, SOFT_SPRING, SPRING, Stagger, rise } from '../components/motion';
import type { Item, Offer as OfferRow } from '../types';

const DEFAULT_BUYER = 'Buyer';
const AMOUNT_ERROR = 'Enter an amount like 30 or 30.50';
const BUYER_KEY = 'offload.buyer';

// The last name this device made an offer under, so a reload keeps the conversation.
function readBuyer(): string | null {
  try {
    return localStorage.getItem(BUYER_KEY);
  } catch {
    return null;
  }
}
function writeBuyer(name: string | null) {
  try {
    if (name) localStorage.setItem(BUYER_KEY, name);
    else localStorage.removeItem(BUYER_KEY);
  } catch {
    /* private mode: memory lasts for this page load only */
  }
}

// What the form sends as the buyer name (the backend trims and clips to 60 too).
const buyerName = (typed: string) => typed.trim().slice(0, 60) || DEFAULT_BUYER;

// ---------- pure helpers ----------

type Tag = 'Close-up' | 'From the seller';
interface Shot {
  src: string;
  tag: Tag | null;
}

// Runner photos first, then the claim close-up (if it isn't already one of them), then anything the seller sent.
function shotsOf(item: Item): Shot[] {
  const out: Shot[] = [];
  const add = (src: string | null | undefined, tag: Tag | null) => {
    if (!src) return;
    const seen = out.find((s) => s.src === src);
    if (seen) {
      if (tag && !seen.tag) seen.tag = tag;
      return;
    }
    out.push({ src, tag });
  };
  (item.photos ?? []).forEach((p) => add(p, p === item.claim_proof ? 'Close-up' : null));
  add(item.claim_proof, 'Close-up');
  (item.seller_proof ?? []).forEach((p) => add(p, 'From the seller'));
  return out;
}

// Shopify's shareable discount link. Only ever built from a real shopify_url and a real code.
function checkoutUrl(shopifyUrl: string | null, code: string | null): string | null {
  if (!shopifyUrl || !code) return null;
  try {
    const u = new URL(shopifyUrl);
    const last = u.pathname.split('/').filter(Boolean).at(-1);
    if (!last) return null;
    const handle = decodeURIComponent(last); // pathname segments arrive percent-encoded; don't encode twice
    return `https://${u.host}/discount/${encodeURIComponent(code)}?redirect=/products/${encodeURIComponent(handle)}`;
  } catch {
    return null;
  }
}

function buyerStatus(item: Item): { label: string; tone: 'plain' | 'green' | 'accent' | 'peach' } {
  switch (item.status) {
    case 'listed':
      return { label: 'Available', tone: 'green' };
    case 'offer':
      return { label: 'Offers coming in', tone: 'accent' };
    case 'sold':
    case 'posted':
      return { label: 'Sold', tone: 'plain' };
    default:
      return { label: 'Coming soon', tone: 'peach' };
  }
}

const claimText = (claim: string) => claim.trim().replace(/[.!\s]+$/, '');

// Round 1 never ends in "rejected" unless the piece had already sold (see server/src/flows.js makeOffer).
const soldFirst = (o: OfferRow) => o.status === 'rejected' && o.round === 1;

// The line under "You've got a deal": only promises what the reply card below actually shows.
function dealNote(o: OfferRow, item: Item): string {
  const full = o.amount >= item.list_price;
  if (!full && !o.discount_code) return 'The price is agreed. The code needs one more try.';
  if (item.shopify_url) return 'Everything you need to check out is below.';
  return full ? 'The seller said yes to the full price.' : 'Your discount code is below.';
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// ---------- page ----------

export default function Offer() {
  const { itemId } = useParams();
  const { state, error, refresh } = useAppState();
  const item = state ? itemById(state, itemId) : null;
  useTitle(item ? item.label : state ? 'Not found' : 'Offer');

  let body: ReactNode;
  if (!state) body = error ? <LoadFailed message={error} onRetry={refresh} /> : <Skeleton />;
  else if (!item) body = <Missing />;
  else body = <ItemView key={item.id} item={item} offers={offersFor(state, item.id)} />;

  return (
    <>
      <Header buyer />
      <main className="of-page" id="main">
        {state ? <SyncBanner /> : null}
        {body}
      </main>
      {USE_MOCK ? <div className="prototype-note">Demo data · running without the backend</div> : null}
      <Footer />
    </>
  );
}

// ---------- the product ----------

type Action = 'form' | 'accept' | 'retry';

function ItemView({ item, offers }: { item: Item; offers: OfferRow[] }) {
  const { upsert } = useAppState();
  const isPhone = useIsPhone();
  const reduce = useReducedMotion();
  const mutation = useMutation(api.makeOffer);

  // The name box starts empty (brief). It's only prefilled when this device is mid-conversation on THIS piece,
  // so a reload keeps the same buyer (and the same round) without surprising a fresh visitor or a bot.
  const [memory] = useState(() => {
    const w = readBuyer();
    const prefill = w && w !== DEFAULT_BUYER && offers.some((o) => o.buyer === w) ? w : '';
    return { who: w, prefill };
  });

  const shots = useMemo(() => shotsOf(item), [item]);
  const [selected, setSelected] = useState<string | null>(null);
  const [who, setWho] = useState<string | null>(memory.who);
  const [name, setName] = useState(memory.prefill);
  const [amount, setAmount] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [forceForm, setForceForm] = useState(false);
  const [replyNonce, setReplyNonce] = useState(0);
  const [formBelow, setFormBelow] = useState(false);

  const [fieldScope, animateField] = useAnimate<HTMLDivElement>();
  const amountRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const replyRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLElement>(null);
  const sending = useRef(false);

  const sold = isSold(item);
  const onSale = isOnSale(item);
  const mine = who ? offers.filter((o) => o.buyer === who) : [];
  const current = mine.at(-1) ?? null;
  const earlier = mine.slice(0, -1);
  const canAct = onSale && current?.status === 'countered' && current.round === 1 && current.counter != null;
  const lastRound = canAct && current != null && buyerName(name) === current.buyer; // same buyer => round 2
  const dealRow = onSale && current?.status === 'accepted' ? current : null;
  const deal = dealRow ? Math.min(dealRow.amount, item.list_price) : null;
  const dealView = dealRow != null && !forceForm;
  const showForm = onSale && !dealView;
  const scrollBehavior: ScrollBehavior = reduce ? 'auto' : 'smooth';
  const conditionNotes = item.condition_notes ?? [];

  // Phones: show the floating "Make an offer" bar only while the offer panel is still below the fold.
  useEffect(() => {
    const el = panelRef.current;
    if (!el || !onSale || typeof IntersectionObserver === 'undefined') {
      setFormBelow(false);
      return;
    }
    const io = new IntersectionObserver(([e]) => setFormBelow(!e.isIntersecting && e.boundingClientRect.top > 0));
    io.observe(el);
    return () => io.disconnect();
  }, [onSale]);

  // After a reply lands, bring it on screen (phones especially). Waits for the old card's exit so it measures the new one.
  useEffect(() => {
    if (!replyNonce) return;
    const t = setTimeout(() => replyRef.current?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior }), 220);
    return () => clearTimeout(t);
  }, [replyNonce, scrollBehavior]);

  async function send(pence: number, buyer: string, kind: Action) {
    if (sending.current) return; // a second tap before re-render; useMutation would drop it anyway
    sending.current = true;
    setAction(kind);
    const offer = await mutation.run(item.id, pence, buyer);
    sending.current = false;
    setAction(null);
    if (!offer) return;
    upsert('offers', offer);
    setWho(offer.buyer);
    writeBuyer(offer.buyer);
    setForceForm(false);
    if (kind === 'form') setAmount('');
    setReplyNonce((n) => n + 1);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mutation.pending || sending.current) return;
    const pence = parsePounds(amount);
    if (pence == null) {
      setFieldError(AMOUNT_ERROR);
      amountRef.current?.focus();
      if (!reduce && fieldScope.current) animateField(fieldScope.current, { x: [0, -8, 8, -5, 5, 0] }, { duration: 0.42 });
      return;
    }
    setFieldError(null);
    if (isPhone) amountRef.current?.blur(); // drop the keyboard so the reply is visible
    send(pence, buyerName(name), 'form');
  }

  function offerAgain() {
    mutation.clearError();
    const el = amountRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center', behavior: scrollBehavior });
  }

  function jumpToForm() {
    panelRef.current?.scrollIntoView({ block: 'start', behavior: scrollBehavior });
    amountRef.current?.focus({ preventScroll: true });
  }

  function seeCloseUp() {
    if (!item.claim_proof) return;
    setSelected(item.claim_proof);
    if (isPhone) galleryRef.current?.scrollIntoView({ block: 'start', behavior: scrollBehavior });
  }

  // "Not Sam?": forget the remembered buyer on this device and start a fresh conversation.
  function forgetMe() {
    writeBuyer(null);
    setWho(null);
    setName('');
    mutation.clearError();
  }

  const status = buyerStatus(item);
  const kicker = item.brand ? `${item.brand} · Preloved` : 'Preloved, with plenty left';
  const showForget = memory.prefill !== '' && name === memory.prefill && who === memory.prefill;

  return (
    <>
      <nav className="of-crumbs" aria-label="Back">
        {item.shopify_url ? (
          <a className="text-link" href={item.shopify_url}>
            <ArrowLeft size={16} aria-hidden /> Back to the shop
          </a>
        ) : (
          <Link className="text-link" to="/">
            <ArrowLeft size={16} aria-hidden /> offload home
          </Link>
        )}
      </nav>

      <div className="of-layout">
        <Gallery item={item} shots={shots} selected={selected} onSelect={setSelected} sold={sold} innerRef={galleryRef} />

        <Stagger className="of-details" gap={0.06} delay={0.08}>
          <motion.span className="eyebrow of-kicker" variants={rise}>
            {kicker.toUpperCase()}
          </motion.span>
          <motion.h1 className="of-title" tabIndex={-1} variants={rise}>
            {item.label}
          </motion.h1>

          <motion.div className="of-price-row" variants={rise}>
            <PriceTag item={item} deal={deal} sold={sold} onSale={onSale} />
            <div className="of-chips">
              {item.grade ? (
                <Chip tone="accent">
                  Grade {item.grade} · {GRADE_LABEL[item.grade]}
                </Chip>
              ) : null}
              <Chip tone={status.tone}>{status.label}</Chip>
            </div>
          </motion.div>

          {item.claim && item.claim_proof ? (
            <motion.div className="of-claim" variants={rise}>
              <span className="of-claim-icon" aria-hidden>
                <Camera size={18} />
              </span>
              <p>Seller says it's {claimText(item.claim)}. Close-up included.</p>
              <button type="button" className="text-link of-link-btn" onClick={seeCloseUp}>
                See the close-up
              </button>
            </motion.div>
          ) : null}

          <motion.dl className="of-facts" variants={rise}>
            <div>
              <dt>Size</dt>
              <dd>{item.size || 'Not marked'}</dd>
            </div>
            <div>
              <dt>Brand</dt>
              <dd>{item.brand || 'No label'}</dd>
            </div>
            <div>
              <dt>Photos</dt>
              <dd>{shots.length ? `${shots.length} real ${shots.length === 1 ? 'photo' : 'photos'}` : 'On the way'}</dd>
            </div>
          </motion.dl>

          {conditionNotes.length || item.special ? (
            <motion.section className="of-section" variants={rise} aria-labelledby="of-condition">
              <h2 className="of-h2" id="of-condition">
                Condition, honestly
              </h2>
              {conditionNotes.length ? (
                <ul className="of-notes">
                  {conditionNotes.map((n, i) => (
                    <li key={`${i}-${n}`}>
                      <span className="of-dot" aria-hidden />
                      {n}
                    </li>
                  ))}
                </ul>
              ) : null}
              {item.special ? (
                <div className="of-special">
                  <Sparkles size={18} aria-hidden />
                  <div>
                    <strong>What makes it special</strong>
                    <p>{item.special}</p>
                  </div>
                </div>
              ) : null}
            </motion.section>
          ) : null}

          {item.seller_story ? (
            <motion.figure className="of-story" variants={rise}>
              <Quote size={22} aria-hidden />
              <blockquote>{item.seller_story}</blockquote>
              <figcaption>From its last owner</figcaption>
            </motion.figure>
          ) : null}

          <motion.section
            ref={panelRef}
            className={`of-offer ${onSale ? '' : 'is-closed'} ${dealView ? 'is-deal' : ''}`}
            variants={rise}
            aria-labelledby="of-offer-title"
          >
            {sold ? (
              <SoldNote item={item} />
            ) : !onSale ? (
              <div className="of-offer-head">
                <h2 id="of-offer-title">Not on sale yet</h2>
                <p>It's still being photographed and priced. Check back soon.</p>
              </div>
            ) : dealView && dealRow ? (
              <div className="of-offer-head">
                <h2 id="of-offer-title">You've got a deal</h2>
                <p>{dealNote(dealRow, item)}</p>
              </div>
            ) : (
              <div className="of-offer-head">
                <h2 id="of-offer-title">Make an offer</h2>
                <p>Name your price and the seller answers straight away. Too low, and they'll suggest one.</p>
              </div>
            )}

            {showForm ? (
              <form className="of-form" onSubmit={onSubmit} noValidate>
                <div className="of-fields">
                  <div className="of-field" ref={fieldScope}>
                    <label htmlFor="offer-amount">Your offer (£)</label>
                    <div className="of-money">
                      <span aria-hidden>£</span>
                      <input
                        ref={amountRef}
                        className="of-input"
                        id="offer-amount"
                        name="amount"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="e.g. 30"
                        value={amount}
                        onChange={(e) => {
                          setAmount(e.target.value);
                          if (fieldError) setFieldError(null);
                          if (mutation.error) mutation.clearError();
                        }}
                        aria-invalid={fieldError ? true : undefined}
                        aria-describedby={fieldError ? 'offer-amount-hint offer-amount-error' : 'offer-amount-hint'}
                      />
                    </div>
                    <p id="offer-amount-hint" className={`of-hint ${lastRound ? 'last' : ''}`}>
                      {lastRound ? "Last round: the seller's next answer is final." : `Asking ${formatMoney(item.list_price)}.`}
                    </p>
                    <AnimatePresence initial={false}>
                      {fieldError ? (
                        <motion.p
                          key="amount-error"
                          id="offer-amount-error"
                          className="of-error"
                          role="alert"
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.25, ease: EASE }}
                        >
                          {fieldError}
                        </motion.p>
                      ) : null}
                    </AnimatePresence>
                  </div>
                  <div className="of-field">
                    <label htmlFor="offer-name">Your name</label>
                    <input
                      className="of-input"
                      id="offer-name"
                      name="buyer"
                      type="text"
                      autoComplete="off"
                      placeholder="e.g. Sam"
                      maxLength={60}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      aria-describedby="offer-name-hint"
                    />
                    <p id="offer-name-hint" className="of-hint">
                      {showForget ? (
                        <>
                          Remembered from your last offer.{' '}
                          <button type="button" className="of-inline-btn" onClick={forgetMe}>
                            Not {memory.prefill}?
                          </button>
                        </>
                      ) : (
                        'Optional. The seller sees it with your offer.'
                      )}
                    </p>
                  </div>
                </div>
                <Button type="submit" className="of-btn of-submit" pending={action === 'form'} disabled={mutation.pending}>
                  Make offer
                  <ArrowUpRight size={18} aria-hidden />
                </Button>
              </form>
            ) : null}

            {mutation.error ? <ErrorNote>{mutation.error}</ErrorNote> : null}

            {sold ? (
              mine.length ? <History offers={mine} title="Your offers" /> : null
            ) : earlier.length ? (
              <History offers={earlier} title="Your earlier offers" />
            ) : null}

            <div className="of-live" role="status" aria-live="polite" ref={replyRef}>
              <AnimatePresence mode="wait">
                {current && !sold ? (
                  <ReplyCard
                    key={current.id}
                    offer={current}
                    item={item}
                    canAct={canAct}
                    canRetry={onSale}
                    busy={mutation.pending}
                    action={action}
                    onAccept={() => current.counter != null && send(current.counter, current.buyer, 'accept')}
                    onRetry={() => send(current.amount, current.buyer, 'retry')}
                    onOfferAgain={offerAgain}
                  />
                ) : null}
              </AnimatePresence>
            </div>

            {dealView ? (
              <button type="button" className="text-link of-link-btn of-again" onClick={() => setForceForm(true)}>
                Make a different offer
              </button>
            ) : null}
          </motion.section>

          <motion.p className="of-trust" variants={rise}>
            <ShieldCheck size={18} aria-hidden />
            <span>Photographed and checked by a local runner, and posted by one when it sells.</span>
          </motion.p>
        </Stagger>
      </div>

      <PhoneBar show={isPhone && showForm && formBelow} item={item} price={item.list_price} onGo={jumpToForm} />
    </>
  );
}

// ---------- gallery ----------

const slide: Variants = {
  enter: (d: number) => ({ opacity: 0, x: d * 28, scale: 1.02 }),
  center: { opacity: 1, x: 0, scale: 1, transition: { duration: 0.5, ease: EASE } },
  exit: (d: number) => ({ opacity: 0, x: d * -28, transition: { duration: 0.32, ease: EASE } }),
};

function Gallery({
  item,
  shots,
  selected,
  onSelect,
  sold,
  innerRef,
}: {
  item: Item;
  shots: Shot[];
  selected: string | null;
  onSelect: (src: string) => void;
  sold: boolean;
  innerRef: Ref<HTMLElement>;
}) {
  const [dir, setDir] = useState(1);
  const [broken, setBroken] = useState<Record<string, true>>({});
  const [loaded, setLoaded] = useState<Record<string, true>>({});
  const n = shots.length;
  const idx = Math.max(0, shots.findIndex((s) => s.src === selected));
  const shot = shots[idx];
  const markBroken = (src: string) => setBroken((b) => (b[src] ? b : { ...b, [src]: true }));
  const markLoaded = (src: string) => setLoaded((l) => (l[src] ? l : { ...l, [src]: true }));

  const go = (i: number, d: number) => {
    if (n < 2) return;
    setDir(d);
    onSelect(shots[(i + n) % n].src);
  };
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowRight') go(idx + 1, 1);
    else if (e.key === 'ArrowLeft') go(idx - 1, -1);
    else return;
    e.preventDefault();
  };
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -50 || info.velocity.x < -400) go(idx + 1, 1);
    else if (info.offset.x > 50 || info.velocity.x > 400) go(idx - 1, -1);
  };

  if (!shot) {
    return (
      <section className="of-gallery" aria-label="Photos" ref={innerRef}>
        <div className="of-stage of-stage-empty">
          <span className="of-empty-icon" aria-hidden>
            <Shirt size={34} />
          </span>
          <strong>Photos are on the way</strong>
          <p>A local runner photographs every piece before it's listed.</p>
        </div>
      </section>
    );
  }

  const alt = (s: Shot, i: number) => `${item.label}${s.tag ? `, ${s.tag.toLowerCase()}` : ''} (photo ${i + 1} of ${n})`;
  const badge = shot.tag ?? (isOnSale(item) && idx === 0 ? 'Ready for its next chapter' : null);
  const ready = Boolean(loaded[shot.src] || broken[shot.src]);

  return (
    <section className="of-gallery" aria-label="Photos" ref={innerRef} onKeyDown={onKey}>
      <div className="of-stage">
        <AnimatePresence initial={false} custom={dir}>
          <motion.div
            key={shot.src}
            className={`of-slide ${ready ? '' : 'is-loading'}`}
            custom={dir}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            drag={n > 1 ? 'x' : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.18}
            onDragEnd={onDragEnd}
          >
            {broken[shot.src] ? (
              <div className="of-broken">
                <ImageOff size={28} aria-hidden />
                <span>This photo didn't load</span>
              </div>
            ) : (
              <img
                // A cached photo can finish before onLoad is wired; the ref catches that so it never stays hidden.
                ref={(el) => {
                  if (el && el.complete && el.naturalWidth > 0) markLoaded(shot.src);
                }}
                src={shot.src}
                alt={alt(shot, idx)}
                className={`${shot.tag ? 'contain' : ''} ${loaded[shot.src] ? 'is-loaded' : ''}`}
                draggable={false}
                decoding="async"
                onLoad={() => markLoaded(shot.src)}
                onError={() => markBroken(shot.src)}
              />
            )}
          </motion.div>
        </AnimatePresence>

        <div className="of-stage-top">
          <AnimatePresence mode="wait" initial={false}>
            {badge ? (
              <motion.span
                key={badge}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25, ease: EASE }}
              >
                <Chip tone={shot.tag ? 'plain' : 'green'}>
                  {shot.tag === 'Close-up' ? <Camera size={13} aria-hidden /> : null}
                  {shot.tag === 'From the seller' ? <UserRound size={13} aria-hidden /> : null}
                  {shot.tag ? shot.tag : badge.toUpperCase()}
                </Chip>
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>

        {sold ? (
          <motion.span
            className="of-stamp"
            aria-hidden
            initial={{ opacity: 0, scale: 1.6, rotate: -32 }}
            animate={{ opacity: 1, scale: 1, rotate: -14 }}
            transition={{ ...SPRING, delay: 0.25 }}
          >
            SOLD
            <small>FOUND A NEW HOME</small>
          </motion.span>
        ) : null}

        {n > 1 ? (
          <>
            <button type="button" className="of-nav prev" aria-label="Previous photo" onClick={() => go(idx - 1, -1)}>
              <ChevronLeft size={20} aria-hidden />
            </button>
            <button type="button" className="of-nav next" aria-label="Next photo" onClick={() => go(idx + 1, 1)}>
              <ChevronRight size={20} aria-hidden />
            </button>
            <span className="of-count" aria-hidden>
              {idx + 1} / {n}
            </span>
          </>
        ) : null}
      </div>

      {n > 1 ? (
        <ul className="of-thumbs" aria-label="All photos">
          <AnimatePresence initial={false}>
            {shots.map((s, i) => (
              <motion.li
                key={s.src}
                layout="position"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={SPRING}
              >
                <button
                  type="button"
                  className={`of-thumb ${i === idx ? 'on' : ''}`}
                  aria-label={`Show photo ${i + 1} of ${n}${s.tag ? `, ${s.tag.toLowerCase()}` : ''}`}
                  aria-pressed={i === idx}
                  title={s.tag ?? undefined}
                  onClick={() => go(i, i >= idx ? 1 : -1)}
                >
                  {broken[s.src] ? (
                    <span className="of-thumb-broken">
                      <ImageOff size={16} aria-hidden />
                    </span>
                  ) : (
                    <img src={s.src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => markBroken(s.src)} />
                  )}
                  {s.tag ? (
                    <span className={`of-thumb-tag ${s.tag === 'Close-up' ? 'is-close' : 'is-seller'}`} aria-hidden>
                      {s.tag === 'Close-up' ? <Camera size={12} /> : <UserRound size={12} />}
                    </span>
                  ) : null}
                  {i === idx ? <motion.span layoutId="of-thumb-ring" className="of-thumb-ring" transition={SPRING} /> : null}
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : null}
    </section>
  );
}

// ---------- price ----------

function PriceTag({ item, deal, sold, onSale }: { item: Item; deal: number | null; sold: boolean; onSale: boolean }) {
  if (!onSale && !sold) {
    return <span className="of-price-soon">Price coming soon</span>;
  }
  if (deal != null && deal < item.list_price) {
    return (
      <div className="of-price-wrap">
        <motion.span
          className="of-price is-deal"
          initial={{ opacity: 0, scale: 0.8, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ ...SPRING, delay: 0.1 }}
        >
          {formatMoney(deal)}
        </motion.span>
        <motion.s
          className="of-price-was"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, ease: EASE, delay: 0.2 }}
        >
          <span className="sr-only">Was </span>
          {formatMoney(item.list_price)}
        </motion.s>
        <span className="of-price-note">Your price</span>
      </div>
    );
  }
  return (
    <motion.span
      className={`of-price ${sold ? 'is-sold' : ''}`}
      initial={{ opacity: 0, scale: 0.86, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ ...SPRING, delay: 0.2 }}
    >
      <CountUp value={item.list_price} />
    </motion.span>
  );
}

// ---------- replies ----------

function ReplyIcon({ status }: { status: OfferRow['status'] }) {
  if (status === 'accepted') {
    return (
      <motion.span
        className="of-reply-icon"
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ ...SPRING, delay: 0.05 }}
        aria-hidden
      >
        <svg viewBox="0 0 24 24" width={20} height={20}>
          <motion.path
            d="M5 12.5l4.5 4.5L19 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.45, delay: 0.2, ease: EASE }}
          />
        </svg>
      </motion.span>
    );
  }
  const Icon = status === 'countered' ? HandCoins : status === 'pending' ? Loader2 : MessageCircle;
  return (
    <span className="of-reply-icon" aria-hidden>
      <Icon size={19} className={status === 'pending' ? 'spin' : undefined} />
    </span>
  );
}

function ReplyCard({
  offer,
  item,
  canAct,
  canRetry,
  busy,
  action,
  onAccept,
  onRetry,
  onOfferAgain,
}: {
  offer: OfferRow;
  item: Item;
  canAct: boolean;
  canRetry: boolean;
  busy: boolean;
  action: Action | null;
  onAccept: () => void;
  onRetry: () => void;
  onOfferAgain: () => void;
}) {
  const full = offer.amount >= item.list_price;
  const dealPrice = Math.min(offer.amount, item.list_price);
  const link = offer.status === 'accepted' ? (full ? item.shopify_url : checkoutUrl(item.shopify_url, offer.discount_code)) : null;

  let body: ReactNode;
  switch (offer.status) {
    case 'accepted':
      body = (
        <>
          <h3 className="of-reply-title">Deal at {formatMoney(dealPrice)}.</h3>
          {full ? (
            <p>That's the full price, so there's no code to add.</p>
          ) : offer.discount_code ? (
            <>
              <p>
                Your code takes {formatMoney(item.list_price - dealPrice)} off.{' '}
                {link ? 'The checkout button adds it for you.' : 'Enter it at checkout.'}
              </p>
              <CodeBox code={offer.discount_code} />
            </>
          ) : (
            // The backend doesn't retry a failed code, so don't promise one. Re-sending the same (already accepted)
            // amount is a real new offer that asks the shop for a code again.
            <>
              <p>Deal agreed. The shop didn't send your discount code just now.</p>
              {canRetry ? (
                <>
                  <div className="of-reply-actions">
                    <Button type="button" variant="accent" className="of-btn" pending={action === 'retry'} disabled={busy} onClick={onRetry}>
                      Ask for the code again
                    </Button>
                  </div>
                  <p className="of-reply-note">This sends the same {formatMoney(offer.amount)} offer again.</p>
                </>
              ) : null}
            </>
          )}
          {link ? (
            <motion.a
              className="button accent of-btn of-checkout"
              href={link}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              transition={{ ...SPRING, delay: 0.25 }}
            >
              {full ? 'Go to the shop' : 'Go to checkout'}
              <ArrowUpRight size={18} aria-hidden />
            </motion.a>
          ) : null}
          {link && SHOP_PASSWORD ? (
            <p className="of-reply-note">
              The shop is a preview store. If it asks for a password, it's <strong>{SHOP_PASSWORD}</strong>.
            </p>
          ) : null}
        </>
      );
      break;
    case 'countered':
      body = (
        <>
          <h3 className="of-reply-title">
            The seller would take <span className="of-reply-money">{formatMoney(offer.counter)}</span>.
          </h3>
          {canAct && offer.counter != null ? (
            <>
              <div className="of-reply-actions">
                <Button type="button" variant="accent" className="of-btn" pending={action === 'accept'} disabled={busy} onClick={onAccept}>
                  Accept {formatMoney(offer.counter)}
                </Button>
                <Button type="button" variant="outline" className="of-btn" disabled={busy} onClick={onOfferAgain}>
                  Offer again
                </Button>
              </div>
              <p className="of-reply-note">Offer again and it's the last round, so the next answer is final.</p>
            </>
          ) : null}
        </>
      );
      break;
    case 'rejected':
      body = soldFirst(offer) ? (
        <>
          <h3 className="of-reply-title">Sorry, it's just sold.</h3>
          <p>Someone else got there first.</p>
        </>
      ) : (
        <>
          <h3 className="of-reply-title">That's a bit low for this one.</h3>
          <p>The seller won't go below what they set.</p>
        </>
      );
      break;
    default:
      body = (
        <>
          <h3 className="of-reply-title">Your offer's with the seller.</h3>
          <p>You'll see the answer here.</p>
        </>
      );
  }

  return (
    <motion.article
      className={`of-reply of-reply-${offer.status}`}
      initial={{ opacity: 0, y: 22, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.18 } }}
      transition={SOFT_SPRING}
    >
      <div className="of-reply-top">
        <ReplyIcon status={offer.status} />
        <span className="of-reply-meta">
          You offered {formatMoney(offer.amount)} · round {offer.round} of 2
        </span>
      </div>
      {body}
    </motion.article>
  );
}

function CodeBox({ code }: { code: string }) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  useEffect(() => {
    if (copied === 'idle') return;
    const t = setTimeout(() => setCopied('idle'), 2200);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <motion.div
      className="of-code"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, ease: EASE, delay: 0.15 }}
    >
      <div className="of-code-text">
        <span className="of-code-label">Discount code</span>
        <code translate="no">{code}</code>
      </div>
      <motion.button
        type="button"
        className={`of-copy ${copied === 'done' ? 'done' : ''}`}
        onClick={async () => setCopied((await copyText(code)) ? 'done' : 'failed')}
        whileTap={{ scale: 0.95 }}
        transition={SPRING}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={copied}
            className="of-copy-inner"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
          >
            {copied === 'done' ? (
              <>
                <Check size={16} aria-hidden /> Copied
              </>
            ) : copied === 'failed' ? (
              'Select it to copy'
            ) : (
              <>
                <Copy size={16} aria-hidden /> Copy
              </>
            )}
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </motion.div>
  );
}

function verdict(o: OfferRow): string {
  switch (o.status) {
    case 'accepted':
      return o.discount_code ? `Accepted · ${o.discount_code}` : 'Accepted';
    case 'countered':
      return `Seller said ${formatMoney(o.counter)}`;
    case 'rejected':
      return soldFirst(o) ? 'It had sold' : 'Declined';
    default:
      return 'Waiting';
  }
}

function History({ offers, title }: { offers: OfferRow[]; title: string }) {
  return (
    <div className="of-earlier">
      <h3>{title}</h3>
      <ol>
        <AnimatePresence initial={false}>
          {offers.map((o) => (
            <motion.li
              key={o.id}
              layout="position"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
            >
              <span>
                You offered <strong>{formatMoney(o.amount)}</strong>
              </span>
              <span className={`of-verdict is-${o.status}`}>{verdict(o)}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}

function SoldNote({ item }: { item: Item }) {
  return (
    <div className="of-offer-head">
      <h2 id="of-offer-title">Sold</h2>
      <p>
        This one's found a new home.{' '}
        {item.status === 'posted' ? "It's on its way to its new owner." : 'If that was you, thank you. A local runner will post it soon.'}
      </p>
      <Link className="text-link of-link-btn" to="/">
        See how offload works <ArrowUpRight size={15} aria-hidden />
      </Link>
    </div>
  );
}

// ---------- phone bar ----------

// Portalled to <body> so the route's transformed wrapper can't break position: fixed.
function PhoneBar({ show, item, price, onGo }: { show: boolean; item: Item; price: number; onGo: () => void }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {show ? (
        <motion.div
          key="of-bar"
          className="of-bar"
          initial={{ y: '120%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '120%', opacity: 0 }}
          transition={SOFT_SPRING}
        >
          <div className="of-bar-info">
            <span>{item.label}</span>
            <strong>{formatMoney(price)}</strong>
          </div>
          <Button type="button" className="of-btn" onClick={onGo}>
            Make an offer
          </Button>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

// ---------- loading / missing / failed ----------

function Skeleton() {
  return (
    <div className="of-layout of-skeleton" role="status" aria-live="polite">
      <span className="sr-only">Loading this piece…</span>
      <div className="of-skel of-skel-photo" aria-hidden />
      <div className="of-skel-col" aria-hidden>
        <div className="of-skel of-skel-line of-w30" />
        <div className="of-skel of-skel-title" />
        <div className="of-skel of-skel-price" />
        <div className="of-skel of-skel-line of-w90" />
        <div className="of-skel of-skel-line of-w70" />
        <div className="of-skel of-skel-panel" />
      </div>
    </div>
  );
}

function Missing() {
  return (
    <motion.section
      className="of-missing"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE }}
    >
      <span className="of-missing-icon" aria-hidden>
        <Shirt size={28} />
      </span>
      <span className="eyebrow">NOT FOUND</span>
      <h1 tabIndex={-1}>We can't find that piece.</h1>
      <p>It may have been removed.</p>
      <ButtonLink to="/">Back home</ButtonLink>
    </motion.section>
  );
}

function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <motion.section
      className="of-missing"
      role="alert"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE }}
    >
      <span className="of-missing-icon" aria-hidden>
        <Shirt size={28} />
      </span>
      <span className="eyebrow">CAN'T CONNECT</span>
      <h1 tabIndex={-1}>We can't load this piece right now.</h1>
      <p>{message} We'll keep trying.</p>
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </motion.section>
  );
}
