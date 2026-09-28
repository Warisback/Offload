// First visit: one question. The name is kept on this device only.
import { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Camera, Package, ShieldCheck, Store } from 'lucide-react';
import { Button } from '../../components/ui';
import { EASE, SPRING, Stagger, rise } from '../../components/motion';
import { formatMoney } from '../../lib/money';
import { RUNNER_FEE } from '../../types';
import { cleanName } from './copy';

const STEPS = [
  { icon: Package, text: 'Accept a pickup nearby' },
  { icon: Camera, text: 'Photograph each piece' },
  { icon: Store, text: 'Hand over. Get paid.' },
];

// teaser: the first open pickup, so the art shows a real job (else the real per-item rate).
export function NameGate({
  onDone,
  heading = 'h1',
  teaser = null,
}: {
  onDone: (name: string) => void;
  heading?: 'h1' | 'h2';
  teaser?: { pay: number; count: number } | null;
}) {
  const [value, setValue] = useState('');
  const name = cleanName(value);
  const H = heading;
  return (
    <motion.section className="rn-gate" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: EASE }}>
      <div className="rn-gate-art" aria-hidden>
        <div className="rn-gate-orb" />
        <motion.div className="rn-gate-card" initial={{ opacity: 0, y: 16, rotate: -6 }} animate={{ opacity: 1, y: 0, rotate: -4 }} transition={{ ...SPRING, delay: 0.15 }}>
          <small>{teaser ? `New pickup · ${teaser.count} items` : 'Every item you collect'}</small>
          <strong>{formatMoney(teaser ? teaser.pay : RUNNER_FEE)}</strong>
          <span>{teaser ? 'for this pickup' : 'per item, posting included'}</span>
        </motion.div>
        <motion.div className="rn-gate-badge" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...SPRING, delay: 0.35 }}>
          <ShieldCheck size={16} /> Verified runner
        </motion.div>
      </div>
      <span className="eyebrow">BE THE RUNNER</span>
      <H className="rn-gate-title" tabIndex={-1}>
        What’s your name?
      </H>
      <p>So the seller knows who’s coming. No sign-up, no password.</p>
      <form
        className="rn-gate-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name) onDone(name);
        }}
      >
        <label htmlFor="rn-name">Your first name</label>
        <div className="rn-gate-row">
          <input
            id="rn-name"
            name="given-name"
            autoComplete="given-name"
            autoCapitalize="words"
            enterKeyHint="go"
            maxLength={40}
            placeholder="e.g. Sam"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
          <Button type="submit" disabled={!name}>
            Let’s go <ArrowRight size={19} aria-hidden />
          </Button>
        </div>
      </form>
      <Stagger className="rn-gate-steps" delay={0.25}>
        {STEPS.map(({ icon: Icon, text }, i) => (
          <motion.div key={text} variants={rise} className="rn-gate-step">
            <span aria-hidden>
              <Icon size={17} />
            </span>
            <small>{i + 1}</small>
            {text}
          </motion.div>
        ))}
      </Stagger>
    </motion.section>
  );
}
