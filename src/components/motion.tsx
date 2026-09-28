// The motion system. One easing, one spring, a few building blocks. Reduced motion is respected globally
// by <MotionConfig reducedMotion="user"> in main.tsx, so these stay simple.
import { PresenceContext, animate, motion, useInView, useReducedMotion, type HTMLMotionProps, type Variants } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatMoney } from '../lib/money';

export const EASE = [0.22, 1, 0.36, 1] as const;
export const SPRING = { type: 'spring', stiffness: 380, damping: 32, mass: 0.8 } as const;
export const SOFT_SPRING = { type: 'spring', stiffness: 170, damping: 24 } as const;

// Fades and lifts children in when they scroll into view (once).
export function Reveal({
  children,
  delay = 0,
  y = 24,
  className,
  ...rest
}: { children: ReactNode; delay?: number; y?: number; className?: string } & Omit<HTMLMotionProps<'div'>, 'children'>) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, ease: EASE, delay }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

// Parent + child variants for staggered lists: <Stagger><motion.div variants={rise}/>...</Stagger>
export const rise: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
};
export const pop: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1, transition: SPRING },
};

export function Stagger({
  children,
  className,
  gap = 0.07,
  delay = 0,
  inView = false,
  ...rest
}: { children: ReactNode; className?: string; gap?: number; delay?: number; inView?: boolean } & Omit<HTMLMotionProps<'div'>, 'children'>) {
  const variants: Variants = { hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: delay } } };
  return (
    <motion.div
      className={className}
      variants={variants}
      initial="hidden"
      {...(inView ? { whileInView: 'show', viewport: { once: true, margin: '-40px' } } : { animate: 'show' })}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

// Counts from the number on screen to the new value. Money by default, ticking in whole pounds and landing on the
// exact amount (no "£31.47" flashing past on the way to £38).
// - The digits are written straight to the DOM, so React never paints the final figure for a frame before the count.
// - It renders <data> elements, not spans, so container rules like ".stats strong>span" never restyle the number.
// - While the number on screen isn't the real one (counting, or waiting to scroll into view), the digits are hidden
//   from assistive tech and an sr-only copy holds the real value, so live regions and readers never hear the frames.
// - A new `format` function each render never restarts the count.
export function CountUp({
  value,
  format,
  duration = 0.9,
  delay = 0,
  className,
  startFrom,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  delay?: number;
  className?: string;
  startFrom?: number; // start here on mount (e.g. 0), counting up once it scrolls into view
}) {
  const ref = useRef<HTMLDataElement>(null);
  const fmt = useRef(format);
  fmt.current = format;
  const final = (format ?? formatMoney)(value);
  const shown = useRef(startFrom ?? value); // the number on screen right now
  const [initialText] = useState(() => (format ?? formatMoney)(Math.round(startFrom ?? value)));
  const [settled, setSettled] = useState(startFrom === undefined || startFrom === value);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const exact = (n: number) => (fmt.current ?? formatMoney)(n);
    const tick = (n: number) =>
      fmt.current ? fmt.current(Math.round(n)) : formatMoney(Math.abs(value) >= 100 ? Math.round(n / 100) * 100 : Math.round(n));
    const land = () => {
      shown.current = value;
      el.textContent = exact(value);
      setSettled(true);
    };
    if (shown.current === value || reduce) return land();
    setSettled(false);
    if (!inView) return; // counts once it's on screen; the sr-only copy already says the real value
    const controls = animate(shown.current, value, {
      duration,
      delay,
      ease: EASE,
      onUpdate: (v) => {
        shown.current = v;
        el.textContent = tick(v);
      },
      onComplete: land,
    });
    return () => controls.stop();
  }, [value, inView, reduce, duration, delay]);

  return (
    <data className={`count-up ${className ?? ''}`} value={value}>
      <data ref={ref} value={value} aria-hidden={settled ? undefined : true}>
        {initialText}
      </data>
      {settled ? null : (
        <data className="sr-only" value={value}>
          {final}
        </data>
      )}
    </data>
  );
}

// Wraps a whole route for enter/exit transitions. The presence context stops here: the route's own entrances,
// Reveal and Stagger always play (even on a first load under <AnimatePresence initial={false}>), and nested exit
// animations never hold up a route change.
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.45, ease: EASE }}
    >
      <PresenceContext.Provider value={null}>{children}</PresenceContext.Provider>
    </motion.div>
  );
}

// Standard press feedback for buttons and cards.
export const press = { whileHover: { y: -2 }, whileTap: { scale: 0.97 }, transition: SPRING } as const;
