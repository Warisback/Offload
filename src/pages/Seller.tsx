// /seller: film your pile, see the estimate, book a pickup, then follow it to the money.
// Phone (< 768px) is a step flow; desktop (>= 768px) is a dashboard. Switched by width, never a toggle.
import './seller.css';
import { AnimatePresence } from 'motion/react';
import { useIsPhone, useTitle } from '../components/ui';
import { DesktopSeller } from './seller/Desktop';
import { PhoneSeller } from './seller/Phone';

export default function Seller() {
  useTitle('Your pile');
  const phone = useIsPhone();
  // A fresh presence scope for the whole page. The router's AnimatePresence starts with initial={false},
  // and Motion passes that down to every nested component of the first page you land on, which would
  // switch off all of this page's entrance animations (rows staggering in, the estimate landing, checks
  // drawing) whenever /seller is opened directly, as it is from a phone. Same key for both layouts, so
  // resizing across 768px swaps them without an exit animation.
  return <AnimatePresence>{phone ? <PhoneSeller key="seller" /> : <DesktopSeller key="seller" />}</AnimatePresence>;
}
