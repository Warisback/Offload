// The money moment: when an earnings figure goes up while you're watching (a sale just landed), a small
// "+£23.10" rises beside it and the number gives one gentle pulse. First paint never celebrates.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'motion/react';
import { EASE, SPRING } from '../../components/motion';
import { formatMoney } from '../../lib/money';

const SHOW_MS = 2600;

export function useGain(value: number) {
  const prev = useRef(value);
  const seq = useRef(0);
  const [gain, setGain] = useState<{ id: number; amount: number } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (value > before) setGain({ id: ++seq.current, amount: value - before });
  }, [value]);
  useEffect(() => {
    if (!gain) return;
    const t = setTimeout(() => setGain(null), SHOW_MS);
    return () => clearTimeout(t);
  }, [gain]);
  return gain;
}

// Wraps a money figure. `children` is the figure itself (usually a <Count>).
export function GainFigure({ value, children, className = '' }: { value: number; children: ReactNode; className?: string }) {
  const gain = useGain(value);
  const pulse = useAnimationControls();
  useEffect(() => {
    if (gain) pulse.start({ scale: [1, 1.07, 1], transition: { duration: 0.6, ease: EASE, delay: 0.15 } });
  }, [gain, pulse]);
  return (
    <span className={`sl-gain-wrap ${gain ? 'is-gain' : ''} ${className}`}>
      <motion.span className="sl-gain-figure" animate={pulse}>
        {children}
      </motion.span>
      {/* The new total is already read out by the figure; this is decoration. */}
      <span className="sl-gain-anchor" aria-hidden>
        <AnimatePresence>
          {gain ? (
            <motion.span
              key={gain.id}
              className="sl-gain"
              initial={{ opacity: 0, y: 10, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -14, transition: { duration: 0.4, ease: EASE } }}
              transition={SPRING}
            >
              +{formatMoney(gain.amount)}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </span>
    </span>
  );
}
