// Right column: the live haggle for the item with the newest offer, told as a chat.
// Buyer: "Would you take £28?"  offload: "How about £33?"  Buyer: "£33 works."  offload: "Deal at £33. Your code: OFFLOAD-..."
// Bubbles that arrive while the page is open appear one at a time after a short typing beat; the chat keeps the newest in view.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, Check, MessagesSquare, Shirt } from 'lucide-react';
import { EASE, SOFT_SPRING, SPRING } from '../../components/motion';
import { Chip } from '../../components/ui';
import { formatMoney } from '../../lib/money';
import { isOnSale, itemById, offersFor, PRICE_SOURCE_LABEL } from '../../lib/selectors';
import type { AppState, Item, Offer } from '../../types';

type Side = 'buyer' | 'agent';
interface Bubble {
  key: string;
  offerId: string;
  side: Side;
  tone?: 'deal' | 'no';
  text: string;
  code?: string | null;
  meta: string;
}

const MAX_PICKS = 4;

// Newest negotiation first: items ordered by their most recent offer.
export function negotiationOrder(s: AppState): string[] {
  const out: string[] = [];
  for (let i = s.offers.length - 1; i >= 0; i--) {
    const id = s.offers[i].item_id;
    if (!out.includes(id) && itemById(s, id)) out.push(id);
  }
  return out;
}

export function bubblesFor(item: Item, offers: Offer[]): Bubble[] {
  const out: Bubble[] = [];
  offers.forEach((o, i) => {
    const prev = offers
      .slice(0, i)
      .reverse()
      .find((p) => p.buyer === o.buyer);
    const buyerText =
      !prev || o.round === 1
        ? `Would you take ${formatMoney(o.amount)}?`
        : prev.counter != null && o.amount === prev.counter
          ? `${formatMoney(o.amount)} works. I'll take it.`
          : `Could you do ${formatMoney(o.amount)}?`;
    out.push({ key: `${o.id}-b`, offerId: o.id, side: 'buyer', text: buyerText, meta: `${o.buyer} · Buyer` });

    if (o.status === 'countered' && o.counter != null) {
      out.push({ key: `${o.id}-a`, offerId: o.id, side: 'agent', text: `How about ${formatMoney(o.counter)}?`, meta: 'offload · Counteroffer' });
    } else if (o.status === 'accepted') {
      out.push({
        key: `${o.id}-a`,
        offerId: o.id,
        side: 'agent',
        tone: 'deal',
        text: o.discount_code ? `Deal at ${formatMoney(o.amount)}. Your code:` : `Deal at ${formatMoney(o.amount)}. I couldn't get a checkout code from the shop just now.`,
        code: o.discount_code,
        meta: 'offload · Accepted',
      });
    } else if (o.status === 'rejected') {
      // Only offer it again if it really is still for sale (someone else may have bought it since).
      const still = isOnSale(item) ? ` It's still here at ${formatMoney(item.list_price)}.` : '';
      out.push({
        key: `${o.id}-a`,
        offerId: o.id,
        side: 'agent',
        tone: 'no',
        text: `Thanks, but that's below what the seller will take.${still}`,
        meta: 'offload · Polite no',
      });
    }
    // pending: no reply yet, the typing dots carry it
  });
  return out;
}

type ChipInfo = { tone: 'green' | 'peach' | 'accent'; label: string };

// The chip follows the conversation as shown, so it never announces "Deal" before the bubble does.
function chipFor(o: Offer, replied: boolean): ChipInfo {
  if (!replied || o.status === 'pending') return { tone: 'accent', label: 'Offer in' };
  if (o.status === 'accepted') return { tone: 'green', label: 'Deal' };
  if (o.status === 'rejected') return { tone: 'peach', label: 'No deal' };
  return { tone: 'accent', label: `Round ${o.round} of 2` };
}

export function Negotiation({
  state,
  activeId,
  order,
  onPick,
  isFreshOffer,
}: {
  state: AppState | null;
  activeId: string | null;
  order: string[];
  onPick: (id: string) => void;
  isFreshOffer: (id: string) => boolean;
}) {
  const item = state && activeId ? itemById(state, activeId) : null;
  const offers = state && item ? offersFor(state, item.id) : [];
  const picks = state ? order.slice(0, MAX_PICKS).map((id) => itemById(state, id)).filter((i): i is Item => Boolean(i)) : [];
  // Bubbles the room has already watched play in. Switching items and back never replays them.
  const played = useRef(new Set<string>());

  // If the operator has scrolled away (down to the rail), a live offer glides this panel back into view. Desktop only,
  // and only when it isn't already visible above the sticky money banner.
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const lastOffer = state?.offers.at(-1);
  const followId = lastOffer && isFreshOffer(lastOffer.id) ? lastOffer.id : null;
  useEffect(() => {
    const el = ref.current;
    if (!followId || !el || !window.matchMedia('(min-width: 1024px)').matches) return;
    const r = el.getBoundingClientRect();
    const clearBottom = window.innerHeight - 190; // the sticky money banner covers the rest
    const seen = Math.min(r.bottom, clearBottom) - Math.max(r.top, 0);
    if (seen >= Math.min(r.height, 420) * 0.8) return; // mostly on screen already: leave the page alone
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, [followId, reduce]);

  return (
    <motion.section
      ref={ref}
      className="lv-panel lv-neg"
      aria-labelledby="lv-neg-title"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE, delay: 0.12 }}
    >
      <div className="lv-head">
        <div>
          <h2 id="lv-neg-title">A little negotiation.</h2>
          <p className="lv-head-sub">Buyers and buying bots haggle. The agent holds the seller's floor.</p>
        </div>
        {picks.length > 1 ? (
          <LayoutGroup id="lv-neg-picks">
            <div className="lv-neg-picks" role="group" aria-label="Choose a negotiation">
              {picks.map((t) => {
                const on = t.id === item?.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    className="lv-neg-pick"
                    aria-pressed={on}
                    aria-label={`Show the haggle for the ${t.label}`}
                    title={t.label}
                    onClick={() => onPick(t.id)}
                  >
                    <Thumb item={t} className="lv-neg-pick-img" size={18} />
                    {on ? <motion.span layoutId="lv-neg-pick-ring" className="lv-neg-pick-ring" transition={SPRING} aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
          </LayoutGroup>
        ) : null}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {item ? (
          <motion.div
            key={item.id}
            className="lv-neg-body"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <Conversation item={item} offers={offers} isFreshOffer={isFreshOffer} played={played.current} />
          </motion.div>
        ) : (
          <motion.div key="empty" className="lv-empty lv-empty-tight" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <MessagesSquare size={26} aria-hidden />
            <strong>No offers yet.</strong>
            <p>When a buyer makes an offer, the back-and-forth plays out here.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

// A product photo that falls back to a quiet placeholder if the URL fails.
function Thumb({ item, className, size }: { item: Item; className: string; size: number }) {
  const [broken, setBroken] = useState(false);
  const photo = !broken ? item.photos[0] : undefined;
  return photo ? (
    <img className={className} src={photo} alt="" decoding="async" onError={() => setBroken(true)} />
  ) : (
    <span className={`${className} lv-ph`} aria-hidden>
      <Shirt size={size} />
    </span>
  );
}

function NegProduct({ item, chip }: { item: Item; chip: ChipInfo | null }) {
  return (
    <div className="lv-neg-product">
      <Link to={`/offer/${item.id}`} className="lv-neg-photo" aria-label={`${item.label}, open the buyer's page`}>
        <Thumb item={item} className="lv-neg-img" size={26} />
      </Link>
      <div className="lv-neg-info">
        <AnimatePresence mode="popLayout" initial={false}>
          {chip ? (
            <motion.span
              key={chip.label}
              className="lv-neg-chip"
              initial={{ opacity: 0, scale: 0.8, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={SPRING}
            >
              <Chip tone={chip.tone}>{chip.label}</Chip>
            </motion.span>
          ) : null}
        </AnimatePresence>
        <strong>{item.label}</strong>
        <p>Listed at {formatMoney(item.list_price)}</p>
        <small>Priced from: {PRICE_SOURCE_LABEL[item.price_source] ?? item.price_source}</small>
        <Link to={`/offer/${item.id}`} className="text-link lv-neg-link">
          Buyer's page <ArrowUpRight size={15} aria-hidden />
        </Link>
      </div>
    </div>
  );
}

function Conversation({
  item,
  offers,
  isFreshOffer,
  played,
}: {
  item: Item;
  offers: Offer[];
  isFreshOffer: (id: string) => boolean;
  played: Set<string>;
}) {
  const bubbles = bubblesFor(item, offers);
  // Already there when the page loaded (or already watched): shown at once. Anything newer plays in, one at a time.
  const [shown, setShown] = useState(() => {
    const firstNew = bubbles.findIndex((b) => isFreshOffer(b.offerId) && !played.has(b.key));
    return firstNew === -1 ? bubbles.length : firstNew;
  });
  const visible = Math.min(shown, bubbles.length);
  const waiting = visible < bubbles.length;
  const nextSide = waiting ? bubbles[visible].side : null;

  useEffect(() => {
    if (shown > bubbles.length) {
      setShown(bubbles.length); // the conversation got shorter (demo reset)
      return;
    }
    if (!nextSide) return;
    const t = setTimeout(() => setShown((n) => n + 1), nextSide === 'agent' ? 1300 : 800);
    return () => clearTimeout(t);
  }, [shown, bubbles.length, nextSide]);

  useEffect(() => {
    for (const b of bubbles.slice(0, visible)) played.add(b.key);
  });

  const typing: Side | null = nextSide ?? (offers.at(-1)?.status === 'pending' ? 'agent' : null);
  const lastShown = visible > 0 ? bubbles[visible - 1] : undefined;
  const shownOffer = lastShown ? offers.find((o) => o.id === lastShown.offerId) : undefined;
  const chip = shownOffer && lastShown ? chipFor(shownOffer, lastShown.side === 'agent') : null;

  // Keep the newest bubble in view; older ones scroll up under a soft fade.
  const chatRef = useRef<HTMLDivElement>(null);
  const firstScroll = useRef(true);
  const reduce = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: firstScroll.current || reduce ? 'auto' : 'smooth' });
    firstScroll.current = false;
  }, [visible, typing, reduce]);

  return (
    <>
      <NegProduct item={item} chip={chip} />
      <motion.div
        ref={chatRef}
        layoutScroll
        className={`lv-chat ${scrolled ? 'is-scrolled' : ''}`}
        aria-live="polite"
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}
      >
        <AnimatePresence initial={false}>
          {bubbles.slice(0, visible).map((b) => (
            <motion.div
              key={b.key}
              layout="position"
              className={`lv-bubble ${b.side} ${b.tone || ''}`}
              initial={{ opacity: 0, y: 14, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ ...SPRING, layout: SOFT_SPRING }}
            >
              {b.tone === 'deal' ? (
                <motion.span
                  className="lv-deal-check"
                  aria-hidden
                  initial={{ scale: 0, rotate: -40 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 18, delay: 0.12 }}
                >
                  <Check size={16} strokeWidth={3} />
                </motion.span>
              ) : null}
              <span className="lv-bubble-text">
                {b.text}
                {b.code ? (
                  <>
                    {' '}
                    <motion.code
                      className="lv-code"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ ...SPRING, delay: 0.25 }}
                    >
                      {b.code}
                    </motion.code>
                  </>
                ) : null}
              </span>
              <small>{b.meta}</small>
            </motion.div>
          ))}
          {typing ? (
            <motion.div
              key={`typing-${typing}`}
              layout="position"
              className={`lv-typing ${typing}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.15 } }}
              transition={SPRING}
            >
              <i aria-hidden />
              <i aria-hidden />
              <i aria-hidden />
              <span className="sr-only">{typing === 'agent' ? 'offload is replying…' : 'The buyer is typing…'}</span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    </>
  );
}
