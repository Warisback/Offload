// Bottom of /live: the latest sale split into seller, runner and offload (backend numbers, never recomputed),
// plus what sellers have earned so far. When a new sale lands, the banner lifts, the numbers count up and the bar redraws.
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, Maximize2, Plus } from 'lucide-react';
import { EASE, SPRING } from '../../components/motion';
import { formatMoney } from '../../lib/money';
import type { Item, Ledger } from '../../types';
import { Counter } from './Counter';
import { SplitBar } from './SplitBar';

export function MoneyBanner({
  row,
  item,
  earned,
  sales,
  fresh,
  loading,
  onOpen,
}: {
  row: Ledger | null;
  item: Item | null;
  earned: number;
  sales: number;
  fresh: boolean; // this row arrived while the page was open
  loading: boolean;
  onOpen: () => void;
}) {
  const [lifted, setLifted] = useState(false);
  const rowId = row?.id ?? null;

  useEffect(() => {
    if (!rowId || !fresh) return;
    setLifted(true);
    const t = setTimeout(() => setLifted(false), 3200);
    return () => clearTimeout(t);
  }, [rowId, fresh]);

  return (
    <div className="lv-banner-wrap">
      <motion.section
        className={`lv-banner ${lifted ? 'is-lifted' : ''}`}
        aria-label="Latest sale"
        initial={{ opacity: 0, y: 28 }}
        animate={lifted ? { opacity: 1, y: -10, scale: 1.012 } : { opacity: 1, y: 0, scale: 1 }}
        transition={lifted ? SPRING : { duration: 0.8, ease: EASE }}
      >
        {/* Announced once when a sale lands while the page is open (the counters themselves stay silent). */}
        <p className="sr-only" role="status">
          {fresh && row
            ? `Just sold${item ? `: ${item.label}` : ''} for ${formatMoney(row.sale_price)}. Seller ${formatMoney(row.seller_amount)}, runner ${formatMoney(row.runner_amount)}, offload ${formatMoney(row.our_amount)}.`
            : ''}
        </p>
        <motion.span className="lv-banner-glow" aria-hidden animate={{ opacity: lifted ? 1 : 0 }} transition={{ duration: lifted ? 0.3 : 1.4, ease: EASE }} />

        {row ? (
          <div className="lv-banner-inner" key={row.id}>
            <div className="lv-banner-row">
              <div className="lv-banner-cell lv-banner-sale">
                <span>
                  <AnimatePresence>
                    {lifted ? (
                      <motion.em className="lv-banner-new" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={SPRING}>
                        <Check size={12} strokeWidth={3} aria-hidden /> Just sold
                      </motion.em>
                    ) : null}
                  </AnimatePresence>
                  Sold{item ? ` · ${item.label}` : ''}
                </span>
                <strong>
                  <Counter value={row.sale_price} from={fresh ? 0 : undefined} duration={1.1} />
                </strong>
              </div>
              <ArrowRight className="lv-banner-op" aria-hidden />
              <div className="lv-banner-cell">
                <span>
                  <i className="lv-sw lv-split-seller" aria-hidden />
                  Seller
                </span>
                <strong>
                  <Counter value={row.seller_amount} from={fresh ? 0 : undefined} delay={fresh ? 0.3 : 0} duration={1.1} />
                </strong>
              </div>
              <Plus className="lv-banner-op" aria-hidden />
              <div className="lv-banner-cell">
                <span>
                  <i className="lv-sw lv-split-runner" aria-hidden />
                  Runner
                </span>
                <strong>
                  <Counter value={row.runner_amount} from={fresh ? 0 : undefined} delay={fresh ? 0.45 : 0} duration={1.1} />
                </strong>
              </div>
              <Plus className="lv-banner-op" aria-hidden />
              <div className="lv-banner-cell">
                <span>
                  <i className="lv-sw lv-split-ours" aria-hidden />
                  offload
                </span>
                <strong>
                  <Counter value={row.our_amount} from={fresh ? 0 : undefined} delay={fresh ? 0.6 : 0} duration={1.1} />
                </strong>
              </div>
              <div className="lv-banner-cell lv-banner-total">
                <span>Earned for sellers</span>
                <strong>
                  {/* remounts per sale, so a fresh sale counts up from the total before it */}
                  <Counter value={earned} from={fresh ? Math.max(0, earned - row.seller_amount) : undefined} duration={1.4} delay={fresh ? 0.8 : 0} />
                </strong>
                <small>
                  {sales} {sales === 1 ? 'sale' : 'sales'} so far
                </small>
              </div>
            </div>
            <SplitBar split={{ seller: row.seller_amount, runner: row.runner_amount, ours: row.our_amount }} animateIn={fresh} delay={0.35} />
          </div>
        ) : (
          <div className="lv-banner-inner lv-banner-empty">
            <div className="lv-banner-cell">
              <span>{loading ? 'Waiting for the shop' : 'The money moment'}</span>
              <strong>First sale lands here.</strong>
            </div>
            <p>Seller keeps 70%. The runner gets £6. offload keeps the rest.</p>
          </div>
        )}

        <button type="button" className="lv-banner-open" onClick={onOpen} aria-label="Open the money screen" title="Money screen (M)">
          <Maximize2 size={16} aria-hidden />
        </button>
      </motion.section>
    </div>
  );
}
