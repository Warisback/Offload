// Item cards: photo (or a soft shimmering placeholder until the runner photographs it), name, grade,
// price, status chip and the seller's own words.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight } from 'lucide-react';
import { SPRING, Stagger, rise } from '../../components/motion';
import { Chip, EmptyState } from '../../components/ui';
import { GRADE_LABEL, STATUS_LABEL, isOnSale, isSold, ledgerFor } from '../../lib/selectors';
import type { AppState, Item, Pickup } from '../../types';
import { previewFor, priceLabel, statusTone, tileTone } from './derive';

// The pastel tile sits underneath until the runner's photo has actually loaded, then the photo fades in
// over it (a CSS transition, so it plays wherever the card mounts). Keyed by URL by the caller.
function Photo({ item }: { item: Item }) {
  const src = item.photos[0];
  const [img, setImg] = useState<'loading' | 'loaded' | 'broken'>('loading');
  const hasPhoto = !!src && img !== 'broken';
  const waiting = item.status === 'estimated' || item.status === 'needs_photos';
  // Shimmer while there's something to wait for: the runner's photos, or this photo loading.
  const shimmer = hasPhoto ? img === 'loading' : waiting;
  return (
    <>
      <span
        className={`sl-ph ${tileTone(item.id)} ${shimmer ? 'is-waiting' : ''}`}
        role={hasPhoto ? undefined : 'img'}
        aria-label={hasPhoto ? undefined : `${item.label}, no photo yet`}
        aria-hidden={hasPhoto || undefined}
      >
        <span className="sl-ph-letter" aria-hidden>
          {(item.brand || item.label).trim().charAt(0).toUpperCase()}
        </span>
        {hasPhoto ? null : <small>{item.status === 'needs_photos' ? 'Retake on the way' : waiting ? 'Photos come with your runner' : 'Photo coming'}</small>}
      </span>
      {hasPhoto ? (
        <img
          ref={(el) => {
            if (el?.complete && el.naturalWidth && img === 'loading') setImg('loaded'); // already cached
          }}
          className={`sl-photo ${img === 'loaded' ? 'is-loaded' : ''}`}
          src={src}
          alt={item.label}
          loading="lazy"
          decoding="async"
          onLoad={() => setImg('loaded')}
          onError={() => setImg('broken')}
        />
      ) : null}
    </>
  );
}

export function ItemCard({ state, pickup, items, item }: { state: AppState; pickup: Pickup; items: Item[]; item: Item }) {
  const sale = ledgerFor(state, item.id);
  const line = previewFor(pickup, items, item);
  const linked = isOnSale(item) || isSold(item);
  const brand = (item.brand || (item.claim || item.price_confidence === 'low' ? 'One of a kind' : 'No label')).toUpperCase();
  const photo = (
    <>
      <Photo key={item.photos[0] || 'placeholder'} item={item} />
      <span className="product-status">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={item.status} className="sl-pop" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={SPRING}>
            <Chip tone={statusTone(item)}>{STATUS_LABEL[item.status]}</Chip>
          </motion.span>
        </AnimatePresence>
      </span>
      {linked ? (
        <span className="product-arrow" aria-hidden>
          <ArrowUpRight size={20} />
        </span>
      ) : null}
    </>
  );
  return (
    <motion.article className="product sl-card" variants={rise} layout="position">
      {linked ? (
        <Link to={`/offer/${item.id}`} className="product-photo" aria-label={`${item.label}, see the listing`}>
          {photo}
        </Link>
      ) : (
        <div className="product-photo">{photo}</div>
      )}
      <div className="product-info">
        <span className="eyebrow">
          {brand}
          {item.size ? ` · ${/^fits/i.test(item.size) ? '' : 'SIZE '}${item.size.toUpperCase()}` : ''}
        </span>
        <div>
          <h3>{item.label}</h3>
          <strong>{priceLabel(item, sale?.sale_price ?? null, line)}</strong>
        </div>
        <p>{item.grade ? `Grade ${item.grade} · ${GRADE_LABEL[item.grade]}` : 'Graded once your runner photographs it'}</p>
        {item.seller_story ? <blockquote>“{item.seller_story}”</blockquote> : null}
      </div>
    </motion.article>
  );
}

export function Pieces({ state, pickup, items }: { state: AppState; pickup: Pickup; items: Item[] }) {
  if (!items.length) {
    return <EmptyState title="Your pieces will show up here">We're still going through the video. Each piece appears as soon as it's spotted.</EmptyState>;
  }
  return (
    <Stagger className="product-grid sl-grid" gap={0.07}>
      {items.map((it) => (
        <ItemCard key={it.id} state={state} pickup={pickup} items={items} item={it} />
      ))}
    </Stagger>
  );
}
