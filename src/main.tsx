import React, { Suspense, lazy, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, MotionConfig } from 'motion/react';
import { StateProvider } from './lib/state';
import { PageTransition } from './components/motion';
import { Loading } from './components/ui';
import './style.css';
import './styles/app.css';

const Landing = lazy(() => import('./pages/Landing'));
const Seller = lazy(() => import('./pages/Seller'));
const Runner = lazy(() => import('./pages/Runner'));
const Live = lazy(() => import('./pages/Live'));
const Offer = lazy(() => import('./pages/Offer'));
const NotFound = lazy(() => import('./pages/NotFound'));

// New page: back to the top (unless jumping to an anchor) and move focus to its heading for screen readers.
function RouteEffects() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) return;
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    const t = setTimeout(() => document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true }), 60);
    return () => clearTimeout(t);
  }, [pathname, hash]);
  return null;
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<PageTransition><Landing /></PageTransition>} />
        <Route path="/seller" element={<PageTransition><Seller /></PageTransition>} />
        <Route path="/runner" element={<PageTransition><Runner /></PageTransition>} />
        <Route path="/live" element={<PageTransition><Live /></PageTransition>} />
        <Route path="/offer/:itemId" element={<PageTransition><Offer /></PageTransition>} />
        <Route path="*" element={<PageTransition><NotFound /></PageTransition>} />
      </Routes>
    </AnimatePresence>
  );
}

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <StateProvider>
          <RouteEffects />
          <Suspense fallback={<Loading label="Opening…" />}>
            <AnimatedRoutes />
          </Suspense>
        </StateProvider>
      </BrowserRouter>
    </MotionConfig>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
