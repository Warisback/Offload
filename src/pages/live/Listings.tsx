// Right column, top: what's on sale right now. Photo, name, price, where the price came from, status.
// The newest pile comes first; a sale stamps SOLD on its card; a ring follows whichever item is being haggled over.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Shirt } from 'lucide-react';
import { EASE, SOFT_SPRING, SPRING } from '../../components/motion';
import { Chip } from '../../components/ui';
import { formatMoney } from '../../lib/money';
import { byCreated, isOnSale, isSold, ledgerFor, PRICE_SOURCE_LABEL, STATUS_LABEL } from '../../lib/selectors';
import type { AppState, Item, ItemStatus } from '../../types';
import { Counter } from './Counter';

const MAX_CARDS = 6;

// 'sold' has no chip: the SOLD stamp says it. 'posted' keeps one, it adds news.
const TONE: Partial<Record<ItemStatus, 'green' | 'accent' | 'plain'>> = { listed: 'green', offer: 'accent', posted: 'plain' };

// Items that are live or sold, newest pile first, keeping each pile's own order so cards don't shuffle between polls.
export function listingItems(s: AppState): Item[] {
  const rank = new Map([...s.pickups].sort(byCreated).reverse().map((p, i) => [p.id, i] as const));
  return s.items
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => isOnSale(item) || isSold(item))
    .sort((a, b) => (rank.get(a.item.pickup_id) ?? 1e6) - (rank.get(b.item.pickup_id) ?? 1e6) || a.idx - b.idx)
    .map(({ item }) => item);
}

export function Listings({ state, activeId, isNewlySold }: { state: AppState | null; activeId: string | null; isNewlySold: (id: string) => boolean }) {
  const items = state ? listingItems(state) : null;
  const shown = items ? items.slice(0, MAX_CARDS) : [];
  const onSale = items ? items.filter(isOnSale).length : 0;
  const sold = items ? items.filter(isSold).length : 0;
  const hidden = items ? items.length - shown.length : 0;

  return (
    <motion.section
      className="lv-panel lv-listings"
      aria-labelledby="lv-listings-title"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE, delay: 0.2 }}
    >
      <div className="lv-head">
        <div>
          <h2 id="lv-listings-title">On the rail</h2>
          <p className="lv-head-sub">
            {items === null ? 'Checking the shop…' : items.length === 0 ? 'Nothing listed yet.' : `${onSale} on sale · ${sold} sold${hidden > 0 ? ` · ${hidden} more not shown` : ''}`}
          </p>
        </div>
      </div>

      {items === null ? (
        <div className="lv-grid" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="lv-skel" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="lv-empty">
          <Shirt size={26} aria-hidden />
          <strong>Listings land here.</strong>
          <p>Once the runner hands a pile over, each piece goes live on the shop and shows up here with its price.</p>
        </div>
      ) : (
        <div className="lv-grid">
          <AnimatePresence initial={true}>
            {shown.map((item, i) => (
              <ListingCard
                key={item.id}
                item={item}
                index={i}
                salePrice={state ? ledgerFor(state, item.id)?.sale_price ?? null : null}
                active={item.id === activeId}
                stampLive={isNewlySold(item.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </motion.section>
  );
}

function ListingCard({
  item,
  index,
  salePrice,
  active,
  stampLive,
}: {
  item: Item;
  index: number;
  salePrice: number | null;
  active: boolean;
  stampLive: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const photo = !broken ? item.photos[0] : undefined;
  const sold = isSold(item);
  return (
    <motion.article
      layout
      className={`lv-card ${sold ? 'is-sold' : ''}`}
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.25 } }}
      transition={{ duration: 0.55, ease: EASE, delay: Math.min(index * 0.06, 0.4), layout: SOFT_SPRING }}
    >
      {active ? <motion.span layoutId="lv-active-ring" className="lv-card-ring" transition={SPRING} aria-hidden /> : null}
      <Link to={`/offer/${item.id}`} className="lv-card-photo" aria-label={`${item.label}, open the buyer page`}>
        {photo ? (
          <img src={photo} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
        ) : (
          <span className="lv-card-ph" aria-hidden>
            <Shirt size={34} />
          </span>
        )}
        {item.status !== 'sold' ? (
          <span className="lv-card-status">
            <Chip tone={TONE[item.status] || 'plain'}>{STATUS_LABEL[item.status]}</Chip>
          </span>
        ) : null}
        <span className="lv-card-arrow" aria-hidden>
          <ArrowUpRight size={18} />
        </span>
        {sold ? (
          <span className="lv-stamp-wrap" aria-hidden>
            <motion.span
              className="lv-stamp"
              initial={stampLive ? { opacity: 0, scale: 2.2, rotate: -28 } : false}
              animate={{ opacity: 1, scale: 1, rotate: -11 }}
              transition={{ type: 'spring', stiffness: 460, damping: 17, mass: 0.9, delay: stampLive ? 0.15 : 0 }}
            >
              Sold
            </motion.span>
          </span>
        ) : null}
      </Link>
      <div className="lv-card-info">
        <h3 title={item.label}>
          {item.label}
          {sold ? <span className="sr-only"> (sold)</span> : null}
        </h3>
        <div className="lv-card-price">
          {sold && salePrice != null ? (
            <>
              <strong>{formatMoney(salePrice)}</strong>
              {salePrice !== item.list_price ? <s aria-label={`listed at ${formatMoney(item.list_price)}`}>{formatMoney(item.list_price)}</s> : null}
            </>
          ) : (
            <strong>
              <Counter value={item.list_price} />
            </strong>
          )}
        </div>
        <span className="lv-card-source">
          Priced from: <b>{PRICE_SOURCE_LABEL[item.price_source] ?? item.price_source}</b>
        </span>
      </div>
    </motion.article>
  );
}
