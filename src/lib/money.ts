// Money helpers. Everything is integer pence; parsing never goes through floating point.
import { RUNNER_FEE, SELLER_SHARE, type Pence } from '../types';

// 3800 -> "£38", 2660 -> "£26.60", -150 -> "-£1.50"
export function formatMoney(pence: Pence | null | undefined): string {
  if (pence == null || !Number.isFinite(pence)) return '';
  const v = Math.round(Math.abs(pence));
  const pounds = Math.floor(v / 100).toLocaleString('en-GB');
  const p = v % 100;
  return `${pence < 0 ? '-' : ''}£${pounds}${p ? `.${String(p).padStart(2, '0')}` : ''}`;
}

// "£85 to £120"
export const formatRange = (low: Pence, high: Pence) => (low === high ? formatMoney(low) : `${formatMoney(low)} to ${formatMoney(high)}`);

// "33", "33.5", "£33.50", " 1,200 " -> pence. Anything else (negative, 3 decimals, letters, zero) -> null.
export function parsePounds(input: string): Pence | null {
  const s = String(input ?? '').trim().replace(/^£/, '').replace(/,/g, '').trim();
  const m = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const pence = Number(m[1]) * 100 + (m[2] ? Number(m[2].padEnd(2, '0')) : 0);
  return pence > 0 ? pence : null;
}

// Pence -> the value to prefill an input with: 3300 -> "33", 3350 -> "33.50"
export const toPoundsInput = (pence: Pence) => (pence % 100 ? (pence / 100).toFixed(2) : String(pence / 100));

// The same split the backend writes to the ledger. Used for previews only.
export function splitSale(sale: Pence) {
  const seller = Math.round(sale * SELLER_SHARE);
  return { sale, seller, runner: RUNNER_FEE, ours: sale - seller - RUNNER_FEE };
}
