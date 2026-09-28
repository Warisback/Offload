// /live: the projector screen. Top right, the runner QR. Left, the agent feed (it stays in view while the right side
// scrolls). Right, the live haggle, then what's on the rail. Bottom, the money banner; M (or the banner's button) opens
// the full money screen. Hidden demo keys E / P / S / 0 push the next cached demo step; a tiny corner dot confirms each one.
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageShell, useTitle } from '../components/ui';
import { api } from '../lib/api';
import { demoKeyAction } from '../lib/keys';
import { eventsNewestFirst, isSold, itemById, sellerEarned } from '../lib/selectors';
import { useAppState } from '../lib/state';
import { Feed } from './live/Feed';
import { useFreshIds } from './live/hooks';
import { KeyDot, type KeyStatus } from './live/KeyDot';
import { Listings } from './live/Listings';
import { MoneyBanner } from './live/MoneyBanner';
import { MoneyScreen } from './live/MoneyScreen';
import { Negotiation, negotiationOrder } from './live/Negotiation';
import { QrPanel } from './live/QrPanel';
import './live.css';

export default function Live() {
  useTitle('Live room');
  const { state, error, online, refresh } = useAppState();
  const [moneyOpen, setMoneyOpen] = useState(false);
  const [keyStatus, setKeyStatus] = useState<KeyStatus>('idle');
  const [pin, setPin] = useState<{ id: string; at: number } | null>(null);
  const demoBusy = useRef(false);

  // What was already there on first load renders calmly; only what arrives live gets the celebration.
  const isFreshEvent = useFreshIds(state ? state.events.map((e) => e.id) : null);
  const isFreshOffer = useFreshIds(state ? state.offers.map((o) => o.id) : null);
  const isFreshSale = useFreshIds(state ? state.ledger.map((l) => l.id) : null);
  const isNewlySold = useFreshIds(state ? state.items.filter(isSold).map((i) => i.id) : null);

  const openMoney = useCallback(() => setMoneyOpen(true), []);
  const closeMoney = useCallback(() => setMoneyOpen(false), []);

  // Hidden keys, /live only. Listeners go when the page goes.
  useEffect(() => {
    let alive = true;
    let hide: ReturnType<typeof setTimeout> | undefined;
    const flash = (s: KeyStatus) => {
      if (!alive) return;
      clearTimeout(hide);
      setKeyStatus(s);
      hide = setTimeout(() => alive && setKeyStatus('idle'), 1500);
    };
    const onKey = async (e: KeyboardEvent) => {
      const action = demoKeyAction(e);
      if (!action) return;
      e.preventDefault();
      if (action.kind === 'money') {
        setMoneyOpen((o) => !o);
        return;
      }
      if (demoBusy.current) return; // one demo call at a time
      demoBusy.current = true;
      clearTimeout(hide);
      setKeyStatus('pending');
      try {
        await api.demo(action.step);
        await refresh();
        flash('ok');
      } catch {
        flash('err');
      } finally {
        demoBusy.current = false;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      alive = false;
      clearTimeout(hide);
      window.removeEventListener('keydown', onKey);
    };
  }, [refresh]);

  const events = state ? eventsNewestFirst(state) : null;
  const order = state ? negotiationOrder(state) : [];
  // The newest negotiation is shown unless the operator picked one; a new offer anywhere hands control back.
  const activeId = pin && state && pin.at === state.offers.length && order.includes(pin.id) ? pin.id : order[0] ?? null;
  const pick = (id: string) => setPin(state ? { id, at: state.offers.length } : null);

  const latestSale = state?.ledger.at(-1) ?? null;
  const saleItem = state && latestSale ? itemById(state, latestSale.item_id) : null;
  const earned = state ? sellerEarned(state) : 0;
  const sales = state?.ledger.length ?? 0;
  const saleIsFresh = latestSale ? isFreshSale(latestSale.id) : false;

  return (
    <div className="lv-page">
      <PageShell
        kicker="THE LIVE ROOM"
        title={
          <>
            Good clothes. Moving in <span className="lv-accent">real time.</span>
          </>
        }
        subtitle="From a wardrobe clear-out to someone's next favourite, with the agent doing the work."
        action={<QrPanel />}
      >
        <div className="lv-layout">
          <Feed events={events} isFresh={isFreshEvent} connected={online && !error} />
          <div className="lv-right">
            <Negotiation state={state} activeId={activeId} order={order} onPick={pick} isFreshOffer={isFreshOffer} />
            <Listings state={state} activeId={activeId} isNewlySold={isNewlySold} />
          </div>
        </div>
        <MoneyBanner row={latestSale} item={saleItem} earned={earned} sales={sales} fresh={saleIsFresh} loading={!state} onOpen={openMoney} />
      </PageShell>
      <MoneyScreen open={moneyOpen} onClose={closeMoney} row={latestSale} item={saleItem} earned={earned} sales={sales} />
      <KeyDot status={keyStatus} />
    </div>
  );
}
