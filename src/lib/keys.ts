// Hidden demo keys on /live: E estimate, P photos, S sale, M money view, 0 reset.
// Ignored while typing or with modifiers held, so they never fire by accident.
import type { DemoStep } from '../types';

export type DemoKeyAction = { kind: 'demo'; step: DemoStep } | { kind: 'money' };

interface KeyLike {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  target?: EventTarget | null;
}

export function isTypingTarget(target: EventTarget | null | undefined): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el !== 'object') return false;
  const tag = (el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(el.isContentEditable);
}

export function demoKeyAction(e: KeyLike): DemoKeyAction | null {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return null;
  if (isTypingTarget(e.target)) return null;
  switch (e.key.toLowerCase()) {
    case 'e':
      return { kind: 'demo', step: 'estimate' };
    case 'p':
      return { kind: 'demo', step: 'photos' };
    case 's':
      return { kind: 'demo', step: 'sale' };
    case '0':
      return { kind: 'demo', step: 'reset' };
    case 'm':
      return { kind: 'money' };
    default:
      return null;
  }
}
