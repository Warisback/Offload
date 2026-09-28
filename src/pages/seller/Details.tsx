// Name + address (+ a typed story when the browser can't listen), and the filming tips.
import { forwardRef, useState } from 'react';
import { motion } from 'motion/react';
import { Camera, Mic, ScanLine, Sun } from 'lucide-react';
import { Stagger, rise } from '../../components/motion';
import { myAddress, mySellerName, setMyAddress, setMySellerName } from '../../lib/selectors';
import { speechSupported } from '../../lib/media';
import type { FilmDetails } from './useFilming';

export function useDetails() {
  const [details, setDetails] = useState<FilmDetails>(() => ({ name: mySellerName() || '', address: myAddress() || '', story: '' }));
  const [error, setError] = useState<string | null>(null);
  const [canListen] = useState(() => speechSupported());
  const set = (k: keyof FilmDetails) => (v: string) => {
    setDetails((d) => ({ ...d, [k]: v }));
    if (k === 'address') setError(null);
  };
  // Validates and remembers the details on this device. Returns true when filming can start.
  const commit = () => {
    const address = details.address.trim();
    if (address.length < 6) {
      setError('Add the address your runner should collect from.');
      return false;
    }
    setMySellerName(details.name.trim() || null);
    setMyAddress(address);
    return true;
  };
  return { details, set, error, setError, commit, canListen };
}
export type Details = ReturnType<typeof useDetails>;

export function Tips({ compact = false }: { compact?: boolean }) {
  const tips = [
    { icon: Sun, text: 'A little daylight goes a long way.' },
    { icon: ScanLine, text: 'Show labels, sizes and any marks.' },
    { icon: Mic, text: 'Something special? Tell its story, and say if you want a price.' },
  ];
  return (
    <Stagger className={`sl-tips ${compact ? 'is-compact' : ''}`} gap={0.08} delay={0.15}>
      {tips.map(({ icon: Icon, text }) => (
        <motion.div className="tip sl-tip" key={text} variants={rise}>
          <span className="sl-tip-icon">
            <Icon size={18} aria-hidden />
          </span>
          <span>{text}</span>
        </motion.div>
      ))}
    </Stagger>
  );
}

// `locked` while recording or sending, so the address can't change under a pile that's on its way.
export const DetailsFields = forwardRef<HTMLInputElement, { d: Details; idPrefix: string; locked?: boolean }>(function DetailsFields(
  { d, idPrefix, locked = false },
  addressRef,
) {
  const errId = `${idPrefix}-address-error`;
  return (
    <fieldset className="sl-fieldset" disabled={locked}>
      <legend className="sr-only">Your details</legend>
      <div className="sl-fields">
        <label className="sl-field" htmlFor={`${idPrefix}-name`}>
          <span>Your first name</span>
          <input
            id={`${idPrefix}-name`}
            value={d.details.name}
            onChange={(e) => d.set('name')(e.target.value)}
            autoComplete="given-name"
            placeholder="Maya"
            maxLength={60}
          />
        </label>
        <label className="sl-field" htmlFor={`${idPrefix}-address`}>
          <span>Where should we collect from?</span>
          <input
            id={`${idPrefix}-address`}
            ref={addressRef}
            value={d.details.address}
            onChange={(e) => d.set('address')(e.target.value)}
            autoComplete="street-address"
            placeholder="18 Lauriston Road, London E9"
            required
            aria-invalid={d.error ? true : undefined}
            aria-describedby={d.error ? errId : undefined}
            maxLength={200}
          />
        </label>
        {d.error ? (
          <motion.p id={errId} className="sl-field-error" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
            {d.error}
          </motion.p>
        ) : null}
        {!d.canListen ? (
          <label className="sl-field" htmlFor={`${idPrefix}-story`}>
            <span>Tell us about the pieces</span>
            <small className="sl-field-hint">This browser can't listen along, so type anything worth knowing: brands, sizes, stories, what you'd want for it.</small>
            <textarea
              id={`${idPrefix}-story`}
              rows={4}
              value={d.details.story}
              onChange={(e) => d.set('story')(e.target.value)}
              placeholder="The denim jacket was my nan's, I'd want £65 for it…"
            />
          </label>
        ) : null}
      </div>
    </fieldset>
  );
});

export function FilmPromise() {
  return (
    <p className="sl-promise">
      <Camera size={14} aria-hidden /> We send a few stills and what you say, never the video.
    </p>
  );
}
