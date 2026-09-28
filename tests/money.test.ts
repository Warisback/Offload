import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, formatRange, parsePounds, splitSale, toPoundsInput } from '../src/lib/money.ts';

test('parsePounds: whole pounds, pence and symbols', () => {
  assert.equal(parsePounds('33'), 3300);
  assert.equal(parsePounds('33.5'), 3350);
  assert.equal(parsePounds('33.50'), 3350);
  assert.equal(parsePounds('£33.50'), 3350);
  assert.equal(parsePounds(' £1,200 '), 120000);
  assert.equal(parsePounds('£1,200'), 120000);
  assert.equal(parsePounds('0.01'), 1);
  assert.equal(parsePounds('999999.99'), 99999999);
});

test('parsePounds: no floating point drift', () => {
  // 0.1 + 0.2 style inputs must land on exact pence
  assert.equal(parsePounds('0.1'), 10);
  assert.equal(parsePounds('0.2'), 20);
  assert.equal((parsePounds('0.1') as number) + (parsePounds('0.2') as number), 30);
  assert.equal(parsePounds('19.99'), 1999);
  assert.equal(parsePounds('1.15'), 115);
  assert.equal(parsePounds('4.35'), 435);
  assert.equal(parsePounds('1.005'), null);
  for (let p = 1; p < 1000; p++) {
    const s = `${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`;
    assert.equal(parsePounds(s), p, s);
  }
});

test('parsePounds: rejects anything that is not a positive amount', () => {
  for (const bad of ['12.345', '-3', '-3.00', '0', '0.00', '', '   ', 'abc', '£', '3.', '.5', '1e3', '12,34.5x', '£-5', 'NaN', 'Infinity', '1 000']) {
    assert.equal(parsePounds(bad), null, JSON.stringify(bad));
  }
  assert.equal(parsePounds(undefined as unknown as string), null);
  assert.equal(parsePounds(null as unknown as string), null);
});

test('formatMoney: pounds, pence only when not whole, negatives, empties', () => {
  assert.equal(formatMoney(3800), '£38');
  assert.equal(formatMoney(2660), '£26.60');
  assert.equal(formatMoney(5), '£0.05');
  assert.equal(formatMoney(0), '£0');
  assert.equal(formatMoney(-150), '-£1.50');
  assert.equal(formatMoney(120000), '£1,200');
  assert.equal(formatMoney(3350.4), '£33.50');
  assert.equal(formatMoney(null), '');
  assert.equal(formatMoney(undefined), '');
  assert.equal(formatMoney(Number.NaN), '');
});

test('formatRange and toPoundsInput', () => {
  assert.equal(formatRange(8500, 12000), '£85 to £120');
  assert.equal(formatRange(3800, 3800), '£38');
  assert.equal(toPoundsInput(3300), '33');
  assert.equal(toPoundsInput(3350), '33.50');
  assert.equal(toPoundsInput(5), '0.05');
  assert.equal(parsePounds(toPoundsInput(2660)), 2660);
});

test('splitSale: 70% seller, flat £6 runner, the rest ours, always adds up', () => {
  assert.deepEqual(splitSale(3300), { sale: 3300, seller: 2310, runner: 600, ours: 390 });
  assert.deepEqual(splitSale(4600), { sale: 4600, seller: 3220, runner: 600, ours: 780 });
  // cheap sales can leave us negative: shown as-is
  assert.deepEqual(splitSale(1000), { sale: 1000, seller: 700, runner: 600, ours: -300 });
  for (const sale of [1, 99, 101, 1999, 3333, 3335, 123457]) {
    const s = splitSale(sale);
    assert.ok(Number.isInteger(s.seller) && Number.isInteger(s.ours), `integers for ${sale}`);
    assert.equal(s.seller + s.runner + s.ours, sale, `sums for ${sale}`);
  }
});
