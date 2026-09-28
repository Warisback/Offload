// Pure helpers for the seller views. Everything reads the polled state; nothing is invented.
import type { AppState, Item, Job, Pickup, PreviewLine } from '../../types';
import { formatMoney } from '../../lib/money';
import { isOnSale, isSold, itemsOf, ledgerOfPickup, pickupJob } from '../../lib/selectors';

export const firstLine = (address: string) => (address || '').split(',')[0].trim();
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// The backend names a pile with no name "Seller": talk to them as "Your" instead.
export const possessive = (name: string) => {
  const n = (name || '').trim();
  if (!n || n.toLowerCase() === 'seller') return 'Your';
  return `${n}${/s$/i.test(n) ? "'" : "'s"}`;
};

// "hand-painted by her sister" -> "hand-painted by your sister" (the chip talks to the seller).
const toYou = (claim: string) => claim.replace(/\b(her|his|their|my)\b/gi, 'your');

// Long claims are clipped at a word so the chip stays a chip.
function clip(text: string, max: number) {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.lastIndexOf(' ', max);
  return `${t.slice(0, cut > max / 2 ? cut : max).replace(/[,.;:\s]+$/, '')}…`;
}

// The chip on estimate rows: a seller claim first, then one-of-a-kind pieces priced with low confidence.
export function claimChip(item: Item): string | null {
  if (item.claim) return /\bsign/i.test(item.claim) ? 'Signed, you said' : `You said: ${clip(toYou(item.claim), 52)}`;
  if (item.price_confidence === 'low') return 'One of a kind';
  return null;
}

export const wantsAsk = (item: Item) => item.price_confidence === 'low' || !!item.claim || item.seller_ask != null;

// The preview line for an item. The backend builds preview from the items in order, so the same position
// wins when its label agrees (two "White tee"s each get their own line), then any line with that label,
// then the same position.
export function previewFor(pickup: Pickup, items: Item[], item: Item): PreviewLine | null {
  const i = items.findIndex((x) => x.id === item.id);
  const atIndex = i >= 0 ? pickup.preview[i] : undefined;
  if (atIndex && atIndex.label === item.label) return atIndex;
  return pickup.preview.find((p) => p.label === item.label) || atIndex || null;
}

export type StepState = 'done' | 'current' | 'todo';
export interface TrackStep {
  key: string;
  title: string;
  detail: string;
  state: StepState;
  money?: number; // seller's share, for sale rows
  sale?: boolean;
  now?: string; // what's happening right now, in a few words, while this is the current step
}

// The pickup's journey: Booked, Runner on the way, Collected, Listed, then each sale.
export function trackerSteps(s: AppState, p: Pickup, localJob?: Job | null): TrackStep[] {
  const job = pickupJob(s, p.id) || (localJob && localJob.pickup_id === p.id ? localJob : null);
  const items = itemsOf(s, p.id);
  const n = items.length || p.preview.length;
  const runner = job?.runner_name || p.runner_name;
  const booked = !!job || p.status !== 'estimated';
  const collected = job?.status === 'done' || p.status === 'collected' || p.status === 'listed';
  const accepted = collected || (!!runner && job?.status !== 'open');
  const live = items.filter((i) => isOnSale(i) || isSold(i)).length;
  const listed = p.status === 'listed' || live > 0;
  const retakes = items.filter((i) => i.status === 'needs_photos').length;
  const sales = ledgerOfPickup(s, p.id);

  const at = (done: boolean, ready: boolean): StepState => (done ? 'done' : ready ? 'current' : 'todo');
  const steps: TrackStep[] = [
    {
      key: 'booked',
      title: booked ? 'Pickup booked' : 'Book a pickup',
      detail: booked ? `Collecting from ${firstLine(p.address) || 'your address'}` : 'One tap once you like the estimate',
      state: at(booked, true),
      now: 'Ready when you are',
    },
    {
      key: 'runner',
      title: 'Runner on the way',
      detail: accepted
        ? `${runner || 'Your runner'} · verified local runner`
        : booked
          ? "We'll tell you who as soon as a runner accepts"
          : 'A vetted local runner comes to you',
      state: at(accepted, booked),
      now: 'Finding you a runner',
    },
    {
      key: 'collected',
      title: 'Collected',
      detail: collected ? `${plural(n, 'piece')}, all accounted for` : accepted ? `${runner || 'Your runner'} is heading to you` : 'Photographed on the spot',
      state: at(collected, accepted),
      now: `${runner || 'Your runner'} is on the way`,
    },
    {
      key: 'listed',
      title: 'Listed',
      detail: listed
        ? `${live} of ${plural(n, 'piece')} listed${retakes ? ` · ${plural(retakes, 'retake')} on the way` : ''}`
        : collected
          ? retakes
            ? `Waiting on ${plural(retakes, 'retake')}, then it's live`
            : 'Grading and pricing your pieces'
          : 'We price, list and handle the buyers',
      state: at(listed, collected),
      now: retakes ? `Waiting on ${plural(retakes, 'retake')}` : 'Grading and pricing your pieces',
    },
  ];

  for (const l of sales) {
    const item = items.find((i) => i.id === l.item_id);
    const label = item?.label || 'A piece';
    steps.push({
      key: `sale-${l.id}`,
      title: `${label} sold for ${formatMoney(l.sale_price)}`,
      detail: item?.status === 'posted' ? 'Posted to its new home' : 'Your runner is posting it',
      state: 'done',
      money: l.seller_amount,
      sale: true,
    });
  }
  if (listed && items.some(isOnSale)) {
    const offer = items.find((i) => i.status === 'offer');
    steps.push({
      key: 'waiting',
      title: sales.length ? 'More buyers on the way' : 'Waiting for the first buyer',
      detail: offer ? `There's an offer in on the ${offer.label}` : "We'll haggle so you don't have to",
      state: 'current',
      now: offer ? `An offer's in on the ${offer.label}` : undefined,
    });
  }
  return steps;
}

// One line for "where's my pile at?": the current step's live phrase, or a calm finish.
export function statusNow(steps: TrackStep[]): { live: boolean; text: string } {
  const c = steps.find((s) => s.state === 'current');
  if (c) return { live: true, text: c.now || c.title };
  return { live: false, text: steps.some((s) => s.sale) ? "Everything's found a new home." : 'All caught up.' };
}

// Price to show on a card: the sale, the listing, or (until it's graded and priced) the estimate range.
export function priceLabel(item: Item, sale: number | null, line: PreviewLine | null): string {
  if (sale != null) return formatMoney(sale);
  if ((item.status === 'estimated' || item.status === 'needs_photos') && line) return line.low === line.high ? formatMoney(line.low) : `${formatMoney(line.low)}–${formatMoney(line.high)}`;
  return formatMoney(item.list_price);
}

export type ChipTone = 'plain' | 'green' | 'accent' | 'peach' | 'warn';
export function statusTone(item: Item): ChipTone {
  if (isSold(item)) return 'green';
  if (item.status === 'needs_photos') return 'warn';
  if (item.status === 'offer') return 'accent';
  return 'plain';
}

// A soft pastel for placeholder tiles, stable per item.
const TILES = ['lavender', 'mint', 'peach'] as const;
export function tileTone(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return TILES[Math.abs(h) % TILES.length];
}


export const timeOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};
