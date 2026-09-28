// Payout: total earned so far (the seller's 70% from the ledger), big, then each sale.
import { motion } from 'motion/react';
import { ArrowUpRight } from 'lucide-react';
import { Stagger, rise } from '../../components/motion';
import { formatMoney } from '../../lib/money';
import { isOnSale, ledgerOfPickup, sellerEarned } from '../../lib/selectors';
import type { AppState, Item, Pickup } from '../../types';
import { Count } from './Count';
import { plural } from './derive';

export function Earnings({ state, pickup, items }: { state: AppState; pickup: Pickup; items: Item[] }) {
  const earned = sellerEarned(state, pickup.id);
  const sales = ledgerOfPickup(state, pickup.id);
  const onSale = items.filter(isOnSale).length;
  return (
    <section className="earnings-card sl-earnings" aria-label="Your earnings">
      <span className="eyebrow">A LITTLE MORE IN YOUR POCKET</span>
      <h2>
        <Count value={earned} startFrom={0} duration={1.3} />
      </h2>
      <p>
        {sales.length
          ? `Your share of ${plural(sales.length, 'sale')} so far. You keep 70% of every one.`
          : "Nothing's sold yet. Your 70% of every sale adds up here."}
      </p>
      {sales.length ? (
        <Stagger className="sl-sales" gap={0.08} delay={0.3}>
          {sales.map((l) => {
            const it = items.find((i) => i.id === l.item_id);
            return (
              <motion.div className="sale-line" key={l.id} variants={rise}>
                <span>
                  {it?.label || 'A piece'}
                  <small>Sold for {formatMoney(l.sale_price)}</small>
                </span>
                <strong>
                  + <Count value={l.seller_amount} />
                </strong>
              </motion.div>
            );
          })}
        </Stagger>
      ) : null}
      <small className="sl-earn-foot">
        {onSale ? (
          <>
            <ArrowUpRight size={13} aria-hidden /> {plural(onSale, 'piece')} still on sale
          </>
        ) : sales.length ? (
          'Everything from this pile has found a home.'
        ) : (
          'Earnings appear here the moment something sells.'
        )}
      </small>
    </section>
  );
}
