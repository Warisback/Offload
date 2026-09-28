// "Expect £X to £Y", one row per spotted piece, seller prices for one-offs and claims, then "Book a pickup".
import { useEffect, useId, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, MapPin, RotateCcw, Sparkles } from 'lucide-react';
import { EASE, SPRING, Stagger, rise } from '../../components/motion';
import { Button, Chip, ErrorNote } from '../../components/ui';
import { api } from '../../lib/api';
import { formatMoney, formatRange, parsePounds, toPoundsInput } from '../../lib/money';
import { compsMedian } from '../../lib/selectors';
import { useAppState, useMutation } from '../../lib/state';
import type { Item, Job, Pickup, PreviewLine } from '../../types';
import { Count } from './Count';
import { claimChip, firstLine, plural, previewFor, wantsAsk } from './derive';

function AskInput({ item, line }: { item: Item; line: PreviewLine | null }) {
  const { upsert } = useAppState();
  const m = useMutation(api.setAsk);
  const id = useId();
  const [value, setValue] = useState(item.seller_ask != null ? toPoundsInput(item.seller_ask) : '');
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const median = compsMedian(item);

  // Follow the server's value (e.g. "I want £65" heard in the video) until the seller types.
  useEffect(() => {
    if (!dirty) setValue(item.seller_ask != null ? toPoundsInput(item.seller_ask) : '');
  }, [item.seller_ask, dirty]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const pence = parsePounds(value);
    if (pence == null) {
      setErr('Try a number like 45 or 45.50');
      return;
    }
    setErr(null);
    const res = await m.run(item.id, pence);
    if (res) {
      upsert('items', res);
      setDirty(false);
    }
  };
  const clear = async () => {
    const res = await m.run(item.id, null);
    if (res) {
      upsert('items', res);
      setDirty(false);
    }
  };

  const message = err || m.error;
  return (
    <form className="sl-ask" onSubmit={submit} noValidate aria-busy={m.pending || undefined}>
      <label htmlFor={id}>
        Set your price<span className="sr-only"> for the {item.label}</span>
      </label>
      <div className="sl-ask-row">
        <span className="sl-ask-input">
          <span aria-hidden>£</span>
          <input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            value={value}
            placeholder={line ? toPoundsInput(line.high) : '40'}
            onChange={(e) => {
              setValue(e.target.value);
              setDirty(true);
              setErr(null);
            }}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? `${id}-msg` : undefined}
          />
        </span>
        <Button type="submit" variant="outline" className="sl-ask-btn" pending={m.pending}>
          {item.seller_ask != null ? 'Update' : 'Set'}
        </Button>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {message ? (
          <motion.p key="err" id={`${id}-msg`} className="sl-field-error" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {message}
          </motion.p>
        ) : item.seller_ask != null ? (
          <motion.p key={`ok-${item.seller_ask}`} className="sl-ask-ok" role="status" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={SPRING}>
            <Check size={15} aria-hidden /> We'll list it at your {formatMoney(item.seller_ask)}.
            <button type="button" className="text-link" onClick={clear} disabled={m.pending}>
              Use our price instead
            </button>
          </motion.p>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {median != null && item.seller_ask != null && median < item.seller_ask ? (
          <motion.p
            key="comps"
            className="sl-ask-note"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE, delay: 0.15 }}
          >
            Similar ones sell around {formatMoney(median)}. We'll still list it at yours.
          </motion.p>
        ) : null}
      </AnimatePresence>
    </form>
  );
}

function Row({ line, item }: { line: PreviewLine | null; item: Item | null }) {
  const chip = item ? claimChip(item) : null;
  return (
    <motion.article className="sl-row" variants={rise} layout="position">
      <div className="sl-row-main">
        <div className="sl-row-name">
          <h3>{item?.label || line?.label}</h3>
          <AnimatePresence>
            {chip ? (
              <motion.span key={chip} className="sl-pop" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={SPRING}>
                <Chip tone="peach">
                  <Sparkles size={12} aria-hidden /> <span className="sl-chip-text">{chip}</span>
                </Chip>
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>
        <strong className="sl-row-range">{line ? formatRange(line.low, line.high) : item ? formatMoney(item.list_price) : ''}</strong>
      </div>
      {item && wantsAsk(item) ? <AskInput key={item.id} item={item} line={line} /> : null}
    </motion.article>
  );
}

export function Estimate({
  pickup,
  items,
  onBooked,
  onFilmAgain,
  desk = false,
}: {
  pickup: Pickup;
  items: Item[];
  onBooked: (job: Job) => void;
  onFilmAgain?: () => void;
  desk?: boolean;
}) {
  const book = useMutation(api.book);
  const n = items.length || pickup.preview.length;
  const rows: { line: PreviewLine | null; item: Item | null }[] = items.length
    ? items.map((it) => ({ item: it, line: previewFor(pickup, items, it) }))
    : pickup.preview.map((line) => ({ line, item: null }));

  const onBook = async () => {
    const job = await book.run(pickup.id);
    if (job) onBooked(job);
  };

  // Phone: this is the page's headline. Desktop: PageShell owns the h1.
  const Heading = desk ? motion.h2 : motion.h1;
  const head = (
    <div className="sl-estimate-copy">
      <span className="eyebrow">YOUR PILE HAS POTENTIAL</span>
      <Heading
        className="sl-estimate-head"
        tabIndex={-1}
        initial={{ opacity: 0, y: 28, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 240, damping: 20, delay: 0.1 }}
      >
        Expect <Count className="sl-num" value={pickup.estimate_low} startFrom={0} duration={1.1} />{' '}
        <span className="sl-to">to</span>{' '}
        <Count className="sl-num" value={pickup.estimate_high} startFrom={0} duration={1.3} />
      </Heading>
      <p>
        {plural(n, 'piece')} spotted. Here's what each could fetch once it's graded and listed.
      </p>
    </div>
  );

  const cta = (
    <>
      <div className="sl-book">
        {pickup.address ? (
          <p className="sl-book-where">
            <MapPin size={15} aria-hidden /> A vetted runner collects from {firstLine(pickup.address)}
          </p>
        ) : null}
        <Button className="sl-cta" pending={book.pending} onClick={onBook}>
          Book a pickup <ArrowRight size={19} aria-hidden />
        </Button>
        {book.error ? <ErrorNote onRetry={onBook}>{book.error}</ErrorNote> : null}
      </div>
      {onFilmAgain ? (
        <button type="button" className="text-link sl-link-quiet sl-film-again" onClick={onFilmAgain}>
          <RotateCcw size={14} aria-hidden /> Not quite right? Film again
        </button>
      ) : null}
    </>
  );

  return (
    <section className={`sl-estimate ${desk ? 'is-desk' : ''}`} aria-label="Your estimate">
      <div className="sl-estimate-left">
        {head}
        {desk ? cta : null}
      </div>
      <div className="sl-estimate-right">
        <Stagger className="sl-rows" gap={0.08} delay={0.35}>
          {rows.map((r, i) => (
            <Row key={`r${i}`} line={r.line} item={r.item} />
          ))}
        </Stagger>
        <AnimatePresence>
          {!items.length ? (
            <motion.p className="sl-soft-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}>
              Checking the details on each piece…
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>
      {desk ? null : cta}
    </section>
  );
}
