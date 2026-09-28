// The pickup timeline. Each step lights up with a check that draws itself; a step that finishes while you
// watch (a new sale, the runner collecting) glows once and its money counts up from zero.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { EASE, SPRING } from '../../components/motion';
import { Count } from './Count';
import type { StepState, TrackStep } from './derive';

export function CheckDraw({ size = 16, delay = 0.12 }: { size?: number; delay?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <motion.path
        d="M5 12.5l4.3 4.3L19 7"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.5, ease: EASE, delay }}
      />
    </svg>
  );
}

// Remounted (keyed by state) whenever a step changes, so the pop and the check draw replay on every change.
function Dot({ state, delay }: { state: StepState; delay: number }) {
  return (
    <motion.span
      className={`sl-dot is-${state}`}
      initial={state === 'todo' ? false : { scale: 0.5, opacity: 0.4 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ ...SPRING, delay }}
    >
      {state === 'done' ? <CheckDraw delay={delay + 0.1} /> : state === 'current' ? <span className="sl-dot-core" /> : null}
    </motion.span>
  );
}

const STATE_TEXT: Record<StepState, string> = { done: 'done', current: 'happening now', todo: 'coming up' };
const GLOW_MS = 2600;

export function Timeline({ steps }: { steps: TrackStep[] }) {
  // Steps already done when the timeline first appears don't celebrate. Worked out during render (not in an
  // effect) so a brand new sale row mounts already "fresh" and its money counts up from £0.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(steps.filter((s) => s.state === 'done').map((s) => s.key));
  const fresh = steps.filter((s) => s.state === 'done' && !seen.current!.has(s.key)).map((s) => s.key);
  const freshKey = fresh.join('|');

  // After the glow, remember them (and re-render so the class comes off).
  const [, settle] = useState(0);
  useEffect(() => {
    if (!freshKey) return;
    const t = setTimeout(() => {
      freshKey.split('|').forEach((k) => seen.current!.add(k));
      settle((n) => n + 1);
    }, GLOW_MS);
    return () => clearTimeout(t);
  }, [freshKey]);

  // Only the first paint staggers in; later changes animate on their own.
  const first = useRef(true);
  useEffect(() => {
    first.current = false;
  }, []);

  return (
    <ol className="sl-timeline">
      {/* Its own presence scope: rows (and the dots inside them) animate on mount even when an outer
          AnimatePresence started with initial={false}. */}
      <AnimatePresence>
        {steps.map((s, i) => {
          const isFresh = fresh.includes(s.key);
          const delay = first.current ? i * 0.08 : 0;
          const last = i === steps.length - 1;
          return (
            <motion.li
              key={s.key}
              layout="position"
              className={`sl-step is-${s.state} ${s.sale ? 'is-sale' : ''} ${isFresh ? 'is-fresh' : ''}`}
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: EASE, delay }}
            >
              {last ? null : (
                <span className="sl-step-line" aria-hidden>
                  {s.state === 'done' ? (
                    <motion.i initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.6, ease: EASE, delay: delay + 0.25 }} />
                  ) : null}
                </span>
              )}
              <Dot key={s.state} state={s.state} delay={delay} />
              <div className="sl-step-body">
                <strong>{s.title}</strong>
                <small>{s.detail}</small>
                <span className="sr-only">, {STATE_TEXT[s.state]}</span>
              </div>
              {s.money != null ? (
                <motion.span
                  className="sl-step-money"
                  initial={isFresh ? { scale: 0.7, opacity: 0 } : false}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ ...SPRING, delay: isFresh ? 0.2 : 0 }}
                >
                  <small>You get</small>
                  <Count value={s.money} startFrom={isFresh ? 0 : undefined} duration={1.1} />
                </motion.span>
              ) : null}
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}
