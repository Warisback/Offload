// Tabs with a shared-layout indicator: a sliding pill on phone, a sliding underline on desktop.
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { EASE, SPRING } from '../../components/motion';

export type TabOption<T extends string> = { id: T; label: string };

function useArrowKeys<T extends string>(options: TabOption<T>[], value: T, onChange: (v: T) => void) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = options.findIndex((o) => o.id === value);
    const last = options.length - 1;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? last : e.key === 'ArrowRight' ? (i + 1) % options.length : (i - 1 + options.length) % options.length;
    onChange(options[next].id);
    refs.current[next]?.focus();
  };
  return { refs, onKeyDown };
}

export function SegTabs<T extends string>({ options, value, onChange, label }: { options: TabOption<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  const { refs, onKeyDown } = useArrowKeys(options, value, onChange);
  return (
    <div className="sl-seg" role="tablist" aria-label={label} onKeyDown={onKeyDown} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o, i) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`sl-tab-${o.id}`}
            aria-selected={on}
            aria-controls={`sl-panel-${o.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.id)}
          >
            {on ? <motion.span layoutId="sl-seg-pill" className="sl-seg-pill" transition={SPRING} /> : null}
            <span className="sl-seg-label">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function LineTabs<T extends string>({
  options,
  value,
  onChange,
  label,
  aside,
}: {
  options: TabOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  aside?: ReactNode;
}) {
  const { refs, onKeyDown } = useArrowKeys(options, value, onChange);
  return (
    <div className="tab-row sl-tabs">
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {options.map((o, i) => {
          const on = o.id === value;
          return (
            <button
              key={o.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="tab"
              id={`sl-tab-${o.id}`}
              aria-selected={on}
              aria-controls={`sl-panel-${o.id}`}
              tabIndex={on ? 0 : -1}
              className={on ? 'selected' : ''}
              onClick={() => onChange(o.id)}
            >
              {o.label}
              {on ? <motion.span layoutId="sl-tab-ink" className="sl-tab-ink" transition={SPRING} /> : null}
            </button>
          );
        })}
      </div>
      {aside ? <span className="muted sl-tabs-aside">{aside}</span> : null}
    </div>
  );
}

// +1 when moving forward through an ordered set of views, -1 when going back, 0 before anything has moved
// (so a first appearance just fades in instead of sliding in from the side).
export function useDirection<T>(value: T, order: (v: T) => number): number {
  const last = useRef(value);
  const dir = useRef(0);
  if (last.current !== value) {
    dir.current = order(value) >= order(last.current) ? 1 : -1;
    last.current = value;
  }
  return dir.current;
}

// The panel under a tab: slides in from the side it was picked from.
export const tabSlide = {
  enter: (d: number) => ({ opacity: 0, x: d * 28 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.4, ease: EASE } },
  exit: (d: number) => ({ opacity: 0, x: d * -28, transition: { duration: 0.2, ease: EASE } }),
};
