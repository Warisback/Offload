// Full-screen layer for the projector (money screen, big QR). Portalled to <body> so no transformed ancestor can trap it.
// Escape closes the top layer only, Tab stays inside it, the page behind stops scrolling (without the scrollbar jump),
// and focus moves in and comes back. Two layers can be open at once (M over the big QR) without fighting over any of that.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { EASE } from '../../components/motion';

// Shared across every open layer: who is on top, and one scroll lock however many layers are open.
const stack: symbol[] = [];
let saved: { overflow: string; paddingRight: string } | null = null;

function lockScroll() {
  if (stack.length !== 1 || saved) return;
  const body = document.body;
  saved = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
  const bar = window.innerWidth - document.documentElement.clientWidth;
  body.style.overflow = 'hidden';
  if (bar > 0) body.style.paddingRight = `${bar}px`;
}
function unlockScroll() {
  if (stack.length || !saved) return;
  document.body.style.overflow = saved.overflow;
  document.body.style.paddingRight = saved.paddingRight;
  saved = null;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Overlay({
  open,
  onClose,
  label,
  className = '',
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const me = Symbol(label);
    const before = document.activeElement as HTMLElement | null;
    stack.push(me);
    lockScroll();

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me) return; // only the top layer reacts
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      const inside = ref.current.contains(document.activeElement);
      const onDialog = document.activeElement === ref.current; // focus starts on the dialog itself
      if (e.shiftKey && (document.activeElement === first || onDialog || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    // Focus the dialog itself: screen readers land in it, Tab reaches the close button, and the projector shows no ring.
    const raf = requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      const i = stack.indexOf(me);
      if (i !== -1) stack.splice(i, 1);
      unlockScroll();
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [open, label]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          className={`lv-overlay ${className}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
