import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoKeyAction, isTypingTarget } from '../src/lib/keys.ts';

const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as unknown as EventTarget;

test('demo keys map to steps (either case)', () => {
  assert.deepEqual(demoKeyAction({ key: 'e' }), { kind: 'demo', step: 'estimate' });
  assert.deepEqual(demoKeyAction({ key: 'E' }), { kind: 'demo', step: 'estimate' });
  assert.deepEqual(demoKeyAction({ key: 'p' }), { kind: 'demo', step: 'photos' });
  assert.deepEqual(demoKeyAction({ key: 's' }), { kind: 'demo', step: 'sale' });
  assert.deepEqual(demoKeyAction({ key: '0' }), { kind: 'demo', step: 'reset' });
  assert.deepEqual(demoKeyAction({ key: 'm' }), { kind: 'money' });
  assert.deepEqual(demoKeyAction({ key: 'e', target: el('DIV') }), { kind: 'demo', step: 'estimate' });
  assert.deepEqual(demoKeyAction({ key: 'e', target: null }), { kind: 'demo', step: 'estimate' });
});

test('other keys do nothing', () => {
  for (const key of ['a', 'x', '1', ' ', 'Enter', 'Escape', 'ArrowLeft', 'Shift', 'F5']) assert.equal(demoKeyAction({ key }), null, key);
});

test('ignored while typing', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'input', 'textarea']) {
    assert.equal(demoKeyAction({ key: 'e', target: el(tag) }), null, tag);
    assert.equal(isTypingTarget(el(tag)), true, tag);
  }
  assert.equal(demoKeyAction({ key: 's', target: el('DIV', { isContentEditable: true }) }), null);
  assert.equal(isTypingTarget(el('BUTTON')), false);
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget(undefined), false);
});

test('ignored with modifiers held (browser shortcuts like Ctrl+S, Cmd+P)', () => {
  for (const mod of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
    assert.equal(demoKeyAction({ key: 's', [mod]: true }), null, mod);
    assert.equal(demoKeyAction({ key: '0', [mod]: true }), null, mod);
  }
});

test('ignored on key repeat (holding a key never fires twice)', () => {
  assert.equal(demoKeyAction({ key: 's', repeat: true }), null);
  assert.deepEqual(demoKeyAction({ key: 's', repeat: false }), { kind: 'demo', step: 'sale' });
});
