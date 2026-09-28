// The big round shutter. A <label> around a real file input with capture="environment", so the phone's own camera
// opens on iOS and Android with no getUserMedia permission dance. Every photo is shrunk before it's kept.
import { useState, type ChangeEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Camera, Loader2, RotateCcw } from 'lucide-react';
import { fileToDataUrl } from '../../lib/images';
import { EASE, SPRING } from '../../components/motion';

export function Shutter({
  onShot,
  label,
  size = 'lg',
  retake = false,
  disabled = false,
}: {
  onShot: (dataUrl: string) => void;
  label: string; // what the screen reader hears, e.g. "Take the front photo"
  size?: 'lg' | 'md';
  retake?: boolean;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ripples, setRipples] = useState<number[]>([]);

  async function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // picking the same file again still fires
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onShot(await fileToDataUrl(file, 1600));
    } catch {
      setError("Couldn't read that photo. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const off = disabled || busy;
  return (
    <div className={`rn-shutter-wrap ${size}`}>
      <motion.label
        className={`rn-shutter ${size} ${busy ? 'is-busy' : ''} ${off ? 'is-off' : ''}`}
        whileTap={off ? undefined : { scale: 0.9 }}
        whileHover={off ? undefined : { scale: 1.04 }}
        transition={SPRING}
        onPointerDown={() => !off && setRipples((r) => [...r, Date.now()])}
      >
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="rn-file"
          aria-label={label}
          disabled={off}
          onChange={onChange}
        />
        <span className="rn-shutter-core" aria-hidden>
          {busy ? <Loader2 className="spin" size={size === 'lg' ? 28 : 20} /> : retake ? <RotateCcw size={size === 'lg' ? 28 : 20} /> : <Camera size={size === 'lg' ? 30 : 21} />}
        </span>
        <AnimatePresence>
          {ripples.map((k) => (
            <motion.span
              key={k}
              className="rn-ripple"
              aria-hidden
              initial={{ scale: 0.7, opacity: 0.55 }}
              animate={{ scale: 2.1, opacity: 0 }}
              transition={{ duration: 0.7, ease: EASE }}
              onAnimationComplete={() => setRipples((r) => r.filter((x) => x !== k))}
            />
          ))}
        </AnimatePresence>
      </motion.label>
      {busy ? <small className="rn-shutter-note" aria-live="polite">Getting it ready…</small> : null}
      {error ? (
        <small className="rn-shutter-note is-error" role="alert">
          {error}
        </small>
      ) : null}
    </div>
  );
}
