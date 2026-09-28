// Shared UI: logo, header, footer, chips, buttons, page shell, and honest loading/empty/error states.
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, ArrowUpRight, Loader2, Menu, RefreshCw, WifiOff, X } from 'lucide-react';
import { useAppState } from '../lib/state';
import { USE_MOCK } from '../lib/config';
import { EASE, SPRING } from './motion';

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · offload` : 'offload · Less wardrobe. More life.';
  }, [title]);
}

export function Logo() {
  return <img className="logo" src="/brand/offload-logo.svg" alt="offload" width={151} height={40} />;
}

export function ButtonLink({ to, children, light = false, className = '' }: { to: string; children: ReactNode; light?: boolean; className?: string }) {
  return (
    <motion.span className="button-wrap" whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} transition={SPRING}>
      <Link className={`button ${light ? 'light' : ''} ${className}`} to={to}>
        {children}
        <ArrowUpRight size={19} aria-hidden />
      </Link>
    </motion.span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'dark' | 'light' | 'outline' | 'accent'; pending?: boolean };

// A real <button> with press feedback and a pending spinner that also blocks double submits.
export function Button({ variant = 'dark', pending = false, disabled, children, className = '', ...rest }: BtnProps) {
  const cls = variant === 'dark' ? '' : variant;
  return (
    <motion.button
      className={`button ${cls} ${className}`}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      whileHover={disabled || pending ? undefined : { y: -2 }}
      whileTap={disabled || pending ? undefined : { scale: 0.97 }}
      transition={SPRING}
      {...(rest as object)}
    >
      {pending ? <Loader2 className="spin" size={18} aria-hidden /> : null}
      {children}
    </motion.button>
  );
}

export function Chip({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'green' | 'accent' | 'peach' | 'warn' }) {
  return <span className={`chip ${tone === 'plain' ? '' : tone}`}>{children}</span>;
}

// Small pill showing where the data comes from and whether it's fresh.
export function ConnectionBadge() {
  const { error, online, state } = useAppState();
  let label = 'Live';
  let tone = 'ok';
  if (USE_MOCK) {
    label = 'Demo data';
    tone = 'mock';
  } else if (!online) {
    label = 'Offline';
    tone = 'bad';
  } else if (error) {
    label = state ? 'Reconnecting' : 'Not connected';
    tone = 'bad';
  }
  return (
    <span className={`conn conn-${tone}`} role="status" aria-live="polite" title={error || undefined}>
      <span className="conn-dot" aria-hidden />
      {label}
    </span>
  );
}

// landing: the marketing nav. buyer: the shop page (/offer/:itemId), where shoppers and the Grok Bot see no internal
// app links, just the brand and a way to sell their own. Default: the app nav with the live connection badge.
// A slim floating glass bar: sticky, shrinks and lifts once you scroll, with a pill that slides to the hovered link.
type NavItem = { to: string; label: string; anchor?: boolean; external?: boolean; live?: boolean };

const LANDING_NAV: NavItem[] = [
  { to: '#how-it-works', label: 'How it works', anchor: true },
  { to: '#your-cut', label: 'Your cut', anchor: true },
  { to: '/runner', label: 'Become a runner', external: true },
];
const APP_NAV: NavItem[] = [
  { to: '/seller', label: 'My wardrobe' },
  { to: '/runner', label: 'Runner hub' },
  { to: '/live', label: 'Live room', live: true },
];

function useScrolled(threshold = 12) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > threshold);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [threshold]);
  return scrolled;
}

function NavItemLink({ item, className, onClick, children }: { item: NavItem; className: (active: boolean) => string; onClick?: () => void; children: ReactNode }) {
  if (item.anchor) {
    return (
      <a href={item.to} className={className(false)} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <NavLink to={item.to} className={({ isActive }) => className(isActive)} onClick={onClick}>
      {children}
    </NavLink>
  );
}

export function Header({ landing = false, buyer = false }: { landing?: boolean; buyer?: boolean }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const scrolled = useScrolled();
  const { pathname } = useLocation();
  const close = () => setOpen(false);
  useEffect(() => setOpen(false), [pathname]);
  const items = buyer ? [] : landing ? LANDING_NAV : APP_NAV;
  const activeTo = items.find((i) => !i.anchor && pathname.startsWith(i.to))?.to ?? null;
  const pillAt = hovered ?? activeTo;

  return (
    <header className={`topbar ${scrolled || open ? 'is-scrolled' : ''}`}>
      <motion.div className="topbar-inner" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
        <Link to="/" aria-label="offload home" className="topbar-logo" onClick={close}>
          <Logo />
        </Link>

        {items.length ? (
          <nav className="topbar-nav" aria-label="Main" onMouseLeave={() => setHovered(null)}>
            {items.map((item) => (
              <NavItemLink key={item.to} item={item} className={(active) => `topbar-link ${active ? 'active' : ''}`}>
                <span onMouseEnter={() => setHovered(item.to)} onFocus={() => setHovered(item.to)} className="topbar-link-inner">
                  {pillAt === item.to ? <motion.span layoutId="topbar-pill" className="topbar-pill" transition={SPRING} aria-hidden /> : null}
                  {item.label}
                  {item.external ? <ArrowUpRight size={14} aria-hidden /> : null}
                  {item.live ? <span className="live-dot" aria-hidden /> : null}
                </span>
              </NavItemLink>
            ))}
          </nav>
        ) : (
          <span className="topbar-spacer" />
        )}

        <div className="topbar-right">
          {buyer ? (
            <Link className="text-link header-sell" to="/">
              Sell yours with offload <ArrowUpRight size={15} aria-hidden />
            </Link>
          ) : landing ? (
            <ButtonLink to="/seller">Start offloading</ButtonLink>
          ) : (
            <ConnectionBadge />
          )}
          {items.length ? (
            <button className="topbar-menu" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(!open)}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={open ? 'x' : 'menu'}
                  className="menu-icon"
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 90, opacity: 0 }}
                  transition={{ duration: 0.18, ease: EASE }}
                >
                  {open ? <X size={22} /> : <Menu size={22} />}
                </motion.span>
              </AnimatePresence>
            </button>
          ) : null}
        </div>
      </motion.div>

      <AnimatePresence>
        {open ? (
          <motion.nav
            className="topbar-sheet"
            aria-label="Main"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: EASE }}
          >
            {items.map((item) => (
              <NavItemLink key={item.to} item={item} onClick={close} className={(active) => `topbar-sheet-link ${active ? 'active' : ''}`}>
                {item.label}
                {item.external ? <ArrowUpRight size={16} aria-hidden /> : null}
                {item.live ? <span className="live-dot" aria-hidden /> : null}
              </NavItemLink>
            ))}
            {landing ? (
              <Link to="/seller" className="button topbar-sheet-cta" onClick={close}>
                Start offloading <ArrowUpRight size={18} aria-hidden />
              </Link>
            ) : null}
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
}

export function Footer() {
  return (
    <footer>
      <Link to="/">
        <Logo />
      </Link>
      <span>A little less in your wardrobe. A little more in your pocket.</span>
      <small>Made in London · 2026</small>
    </footer>
  );
}

// The frame every app page (seller, runner, live) sits in.
export function PageShell({
  children,
  title,
  subtitle,
  kicker,
  action,
  compact = false,
}: {
  children: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  kicker?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <>
      <Header />
      <main className={`workspace ${compact ? 'compact' : ''}`} id="main">
        <motion.div className="workspace-title" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
          <div>
            {kicker ? <span className="eyebrow">{kicker}</span> : null}
            <h1 tabIndex={-1}>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {action}
        </motion.div>
        <SyncBanner />
        {children}
      </main>
      {USE_MOCK ? <div className="prototype-note">Demo data · running without the backend</div> : null}
      <Footer />
    </>
  );
}

// Shows a calm banner when polling fails, with a retry.
export function SyncBanner() {
  const { error, online, refresh, state } = useAppState();
  const show = !USE_MOCK && (Boolean(error) || !online);
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          className="sync-banner"
          role="alert"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
        >
          <div className="sync-inner">
            {online ? <AlertCircle size={18} aria-hidden /> : <WifiOff size={18} aria-hidden />}
            <span>
              {online ? error : "You're offline."} {state ? 'Showing the last update.' : ''}
            </span>
            <button className="text-link" onClick={() => refresh()}>
              <RefreshCw size={15} aria-hidden /> Try again
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state-box" role="status" aria-live="polite">
      <Loader2 className="spin" size={22} aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <motion.div className="state-box empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
      {action}
    </motion.div>
  );
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <motion.div className="error-note" role="alert" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
      <AlertCircle size={18} aria-hidden />
      <span>{children}</span>
      {onRetry ? (
        <button className="text-link" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </motion.div>
  );
}

// True under 768px, the brief's phone/desktop split. Switches on resize, never by a toggle.
export function useIsPhone() {
  const q = '(max-width: 767px)';
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setPhone(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}
