// The last thing judges see: one sale, split three ways, and what sellers have earned so far. Full screen, huge type.
// Opens with M (hidden key) or the operator button. Numbers count up in order; the split bar draws itself.
import { useState } from 'react';
import { motion, type Variants } from 'motion/react';
import { Shirt, X } from 'lucide-react';
import { EASE, SPRING } from '../../components/motion';
import { Logo } from '../../components/ui';
import { formatMoney } from '../../lib/money';
import type { Item, Ledger } from '../../types';
import { Counter } from './Counter';
import { Overlay } from './Overlay';
import { pct, SplitBar } from './SplitBar';

const lift: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: (d: number = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE, delay: d } }),
};

export function MoneyScreen({
  open,
  onClose,
  row,
  item,
  earned,
  sales,
}: {
  open: boolean;
  onClose: () => void;
  row: Ledger | null;
  item: Item | null;
  earned: number;
  sales: number;
}) {
  return (
    <Overlay open={open} onClose={onClose} label="Money screen" className="lv-money">
      <motion.span
        className="lv-money-orb"
        aria-hidden
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1.4, ease: EASE }}
      />
      <header className="lv-money-top">
        <Logo />
        <button type="button" className="lv-overlay-close" onClick={onClose} aria-label="Close the money screen">
          <X size={22} aria-hidden />
        </button>
      </header>
      {row ? <SaleStory key={row.id} row={row} item={item} earned={earned} sales={sales} /> : <NoSaleYet />}
    </Overlay>
  );
}

function SaleStory({ row, item, earned, sales }: { row: Ledger; item: Item | null; earned: number; sales: number }) {
  const [broken, setBroken] = useState(false);
  const photo = item && !broken ? item.photos[0] : undefined;
  const sellerPct = pct(row.seller_amount, row.sale_price);
  const cells = [
    { key: 'seller', label: 'Seller', value: row.seller_amount, note: `${sellerPct}% · theirs, for doing less`, d: 0.55 },
    { key: 'runner', label: 'Runner', value: row.runner_amount, note: 'Collection and posting', d: 0.7 },
    { key: 'ours', label: 'offload', value: row.our_amount, note: 'Everything in between', d: 0.85 },
  ];

  return (
    <motion.div className="lv-money-body" initial="hidden" animate="show">
      <div className="lv-money-hero">
        <motion.div className="lv-money-item" variants={lift} custom={0.05}>
          {photo ? (
            <img src={photo} alt="" onError={() => setBroken(true)} />
          ) : (
            <span className="lv-money-ph" aria-hidden>
              <Shirt size={22} />
            </span>
          )}
          <span>
            <em>One good sale</em>
            {item ? item.label : 'Just now'}
          </span>
        </motion.div>
        {/* "Sold £38." fills the screen; "Sold £133.50." steps down a size so it never runs off the edge. */}
        <motion.h2 className={`lv-money-sold ${formatMoney(row.sale_price).length > 4 ? 'is-long' : ''}`} variants={lift} custom={0.15}>
          Sold <Counter value={row.sale_price} from={0} delay={0.25} duration={1.2} />.
        </motion.h2>
      </div>

      <div className="lv-money-cells">
        {cells.map((c) => (
          <motion.div
            key={c.key}
            className={`lv-money-cell is-${c.key}`}
            initial={{ opacity: 0, y: 30, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ ...SPRING, delay: c.d }}
          >
            <span>
              <i className={`lv-sw lv-split-${c.key}`} aria-hidden />
              {c.label}
            </span>
            <strong>
              <Counter value={c.value} from={0} delay={c.d + 0.1} duration={1.1} />
            </strong>
            <small>{c.note}</small>
          </motion.div>
        ))}
      </div>

      <SplitBar split={{ seller: row.seller_amount, runner: row.runner_amount, ours: row.our_amount }} animateIn delay={1.05} className="lv-money-bar" />

      <motion.div className="lv-money-total" variants={lift} custom={1.3}>
        <span>Earned for sellers so far</span>
        <strong>
          <Counter value={earned} from={0} delay={1.45} duration={1.5} />
        </strong>
        <small>
          From {sales} {sales === 1 ? 'sale' : 'sales'}. Nobody listed a thing.
        </small>
      </motion.div>
    </motion.div>
  );
}

function NoSaleYet() {
  return (
    <motion.div className="lv-money-body lv-money-empty" initial="hidden" animate="show">
      <motion.span className="lv-money-kicker" variants={lift} custom={0.05}>
        The money screen
      </motion.span>
      <motion.h2 className="lv-money-sold" variants={lift} custom={0.15}>
        First sale lands here.
      </motion.h2>
      <motion.p variants={lift} custom={0.3}>
        When something sells, every pound shows up here. The seller keeps 70%, the runner gets £6 for collecting and posting, and offload keeps the rest.
      </motion.p>
      <motion.div variants={lift} custom={0.45}>
        <SplitBar
          split={{ seller: 70, runner: 16, ours: 14 }}
          label="Example split: seller 70%, runner £6, offload the rest"
          animateIn
          delay={0.6}
          className="lv-money-bar"
        />
        <div className="lv-money-legend">
          <span>
            <i className="lv-sw lv-split-seller" aria-hidden /> Seller 70%
          </span>
          <span>
            <i className="lv-sw lv-split-runner" aria-hidden /> Runner £6
          </span>
          <span>
            <i className="lv-sw lv-split-ours" aria-hidden /> offload, the rest
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
