// Where the money went, as one bar: seller, runner, offload. Widths come from the backend's ledger row.
// Segments draw in from the left (scaleX, transform only) one after another.
import { motion } from 'motion/react';
import { EASE } from '../../components/motion';
import { formatMoney } from '../../lib/money';
import type { Pence } from '../../types';

export interface Split {
  seller: Pence;
  runner: Pence;
  ours: Pence;
}

export function SplitBar({
  split,
  animateIn = false,
  delay = 0.2,
  className = '',
  label,
}: {
  split: Split;
  animateIn?: boolean;
  delay?: number;
  className?: string;
  label?: string;
}) {
  // A cheap sale can leave offload's share negative; a bar can't be, so that segment simply isn't drawn.
  const parts = (
    [
      ['seller', split.seller],
      ['runner', split.runner],
      ['ours', split.ours],
    ] as const
  ).filter(([, v]) => v > 0);
  const total = parts.reduce((s, [, v]) => s + v, 0) || 1;
  const aria = label ?? `Seller ${formatMoney(split.seller)}, runner ${formatMoney(split.runner)}, offload ${formatMoney(split.ours)}`;
  return (
    <div className={`lv-split ${className}`} role="img" aria-label={aria}>
      {parts.map(([key, v], i) => (
        <motion.i
          key={key}
          className={`lv-split-${key}`}
          style={{ flexGrow: v / total }}
          initial={animateIn ? { scaleX: 0, opacity: 0 } : false}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ duration: 0.8, ease: EASE, delay: delay + i * 0.16 }}
        />
      ))}
    </div>
  );
}

export const pct = (part: Pence, whole: Pence) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
