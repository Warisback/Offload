// A 6px dot in the corner that tells the operator a hidden key fired. Judges never notice it.
export type KeyStatus = 'idle' | 'pending' | 'ok' | 'err';

const TITLE: Record<KeyStatus, string> = { idle: '', pending: 'Sending…', ok: 'Done', err: 'That step failed' };

export function KeyDot({ status }: { status: KeyStatus }) {
  return <span className={`lv-keydot is-${status}`} title={TITLE[status] || undefined} aria-hidden />;
}
