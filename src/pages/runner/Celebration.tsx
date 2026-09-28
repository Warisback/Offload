// The handover beat: a drawn check, a few sparks, the pay counting up. Short and tasteful.
import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '../../components/ui';
import { EASE, SOFT_SPRING } from '../../components/motion';
import { formatMoney } from '../../lib/money';
import { bringIntoView, plural } from './copy';
import { Money } from './Money';
import type { Celebration as C } from './session';

const SPARKS = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2 + 0.3;
  return { x: Math.cos(a) * 74, y: Math.sin(a) * 74, tone: i % 3 };
});

export function Celebration({ data, name, earned, onDone }: { data: C; name: string; earned: number; onDone: () => void }) {
  // The runner pressed "Confirm handover" further down the page; the pickup card has just gone, so bring the moment to them.
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => bringIntoView(ref.current));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <motion.section
      ref={ref}
      className="rn-celebrate"
      aria-labelledby="rn-celebrate-title"
      layout
      initial={{ opacity: 0, y: 24, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.97, transition: { duration: 0.3 } }}
      transition={SOFT_SPRING}
    >
      <div className="rn-check-wrap" aria-hidden>
        {SPARKS.map((s, i) => (
          <motion.span
            key={i}
            className={`rn-spark t-${s.tone}`}
            initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
            animate={{ x: s.x, y: s.y, scale: [0, 1, 0.4], opacity: [0, 1, 0] }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.75 + i * 0.02 }}
          />
        ))}
        <svg className="rn-check" viewBox="0 0 96 96">
          <motion.circle cx="48" cy="48" r="44" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, ease: EASE }} />
          <motion.path d="M29 50 L42 63 L68 35" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, ease: EASE, delay: 0.55 }} />
        </svg>
      </div>
      <span className="eyebrow">HANDED OVER</span>
      <h2 id="rn-celebrate-title">Listed on the shop</h2>
      <p role="status">
        {plural(data.count, 'item')} {data.count === 1 ? 'is' : 'are'} live now. Nice work, {name}.
      </p>
      <div className="rn-celebrate-money">
        <div>
          <span>You earned</span>
          <strong>
            <span aria-hidden>
              <Money value={data.pay} startFrom={0} duration={1.1} />
            </span>
            <span className="sr-only">{formatMoney(data.pay)}</span>
          </strong>
          <small>for this pickup</small>
        </div>
        <div>
          <span>Today so far</span>
          <strong>
            <span aria-hidden>
              <Money value={earned} />
            </span>
            <span className="sr-only">{formatMoney(earned)}</span>
          </strong>
          <small>posting is included</small>
        </div>
      </div>
      <div className="rn-celebrate-actions">
        <Button onClick={onDone}>Back to jobs</Button>
        <Link className="text-link" to="/live">
          Watch them sell <ArrowUpRight size={16} aria-hidden />
        </Link>
      </div>
    </motion.section>
  );
}
