// Runner copy + the guided photo steps. Plain words, like a person talking.
import type { Item } from '../../types';

export type StepKey = 'front' | 'back' | 'label' | 'marks' | 'claim';

export interface PhotoStep {
  key: StepKey;
  name: string; // short, under the thumbnail
  prompt: string; // the big instruction
  hint: string; // one helpful line under it
  skip?: string; // label for "there's nothing to shoot"
}

const lower = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

export function stepsFor(item: Item): PhotoStep[] {
  const notes = item.condition_notes.filter(Boolean).slice(0, 2);
  const steps: PhotoStep[] = [
    { key: 'front', name: 'Front', prompt: 'Lay it flat and get the front.', hint: 'Whole thing in the frame, in good light.' },
    { key: 'back', name: 'Back', prompt: 'Flip it over. Now the back.', hint: 'Same spot, same light.' },
    {
      key: 'label',
      name: 'Label',
      prompt: 'A clear shot of the label.',
      hint: item.brand ? `Brand and size tag, sharp enough to read.` : 'No brand spotted in the video. Skip if there’s no label.',
      skip: 'No label on it',
    },
    {
      key: 'marks',
      name: 'Any marks',
      prompt: 'Any marks or wear? Get close.',
      hint: notes.length ? `Look out for: ${notes.map(lower).join("; ")}.` : 'Stains, bobbling, fading, loose threads.',
      skip: 'No marks',
    },
  ];
  if (item.claim) {
    steps.push({
      key: 'claim',
      name: 'Close-up',
      prompt: 'Close-up of the signature or the change.',
      hint: `The seller says it’s ${item.claim}. Fill the frame with it.`,
    });
  }
  return steps;
}

export const isPending = (i: Item) => i.status === 'estimated' || i.status === 'needs_photos';

// Photos in upload order: front, back, label, marks, then the claim close-up LAST (the contract's rule).
export function orderedShots(stepKeys: StepKey[], shots: Partial<Record<StepKey, string>>): string[] {
  const order: StepKey[] = ['front', 'back', 'label', 'marks', 'claim'];
  return order.filter((k) => stepKeys.includes(k) && shots[k]).map((k) => shots[k] as string);
}

// Same rule as the backend's feed: lowercase the first word only when it's a common word, never a brand.
const COMMON = new Set(
  ('vintage retro old classic unbranded custom customised customized handmade hand-made hand-painted painted hand signed ' +
    'embroidered wool knit knitted cotton linen silk suede leather faux denim corduroy cashmere fleece quilted waxed wax ' +
    'black white blue grey gray red green navy brown pink cream beige khaki olive yellow orange purple light dark washed ' +
    'hand-embroidered hand-knitted reworked upcycled patchwork teal burgundy maroon mustard lilac lavender ivory charcoal camel rust sage coral mint tan gold silver multicoloured ' +
    'distressed ripped oversized cropped baggy slim straight wide plain striped floral check checked tartan graphic long ' +
    'short sleeveless puffer bomber trucker chunky mini midi maxi summer winter little big football basketball band tour ' +
    'jacket jeans hoodie sweatshirt jumper cardigan coat shirt tee t-shirt dress skirt trousers shorts blazer trainers boots').split(' '),
);
export function the(label: string) {
  const l = label || 'item';
  const first = l.split(/\s+/)[0].toLowerCase().replace(/[^a-z-]/g, '');
  return `the ${COMMON.has(first) ? l.charAt(0).toLowerCase() + l.slice(1) : l}`;
}
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "18 Lauriston Road, Hackney, London E9 7HA" -> "18 Lauriston Road" / "Hackney"
export const street = (address: string) => address.split(',')[0]?.trim() || address;
export function area(address: string) {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts[1] : parts[0] || '';
}
export const rest = (address: string) => address.split(',').slice(1).map((p) => p.trim()).filter(Boolean).join(', ');

export const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

export const cleanName = (v: string) => v.trim().replace(/\s+/g, ' ').slice(0, 40);
export const initial = (name: string) => (name.trim()[0] || '?').toUpperCase();

const scrollBehavior = (): ScrollBehavior =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

// Brings an element's top into view if it's scrolled off (or far down), respecting reduced motion.
export function bringIntoView(el: HTMLElement | null, force = false) {
  if (!el || typeof window === 'undefined') return;
  const top = el.getBoundingClientRect().top;
  if (!force && top >= 0 && top <= window.innerHeight * 0.45) return;
  el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
}

// The photo stage (shutter, grade reveal) must start in the top half of the screen, below the sticky earnings bar.
// If it doesn't, scroll the flow's top (item title) up to the bar. Short phones otherwise open with the shutter off-screen.
export function keepStageInView(root: HTMLElement | null, stage: HTMLElement | null) {
  if (!root || !stage || typeof window === 'undefined') return;
  const bar = document.querySelector('.rn-top')?.getBoundingClientRect().bottom ?? 0;
  const top = stage.getBoundingClientRect().top;
  if (top >= bar && top <= window.innerHeight * 0.5) return;
  root.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
}

export const scrollToTop = () => typeof window !== 'undefined' && window.scrollTo({ top: 0, behavior: scrollBehavior() });

// Retake uploads keep the contract's rule too: a photo answering a claim request (the signature, the painted back) goes last.
export function claimLastOrder(item: Item, indices: number[]): number[] {
  if (!item.claim) return indices;
  const words = item.claim.toLowerCase().split(/[^a-z']+/).filter((w) => w.length > 4);
  const aboutClaim = (i: number) => {
    const r = (item.photo_requests[i] || '').toLowerCase();
    return /signature|signed|autograph|painted|embroider/.test(r) || words.some((w) => r.includes(w));
  };
  return [...indices].sort((a, b) => Number(aboutClaim(a)) - Number(aboutClaim(b)) || a - b);
}
