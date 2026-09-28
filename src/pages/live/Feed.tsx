// Left column: the agent feed. Newest on top, each event a plain sentence with who did it and when.
// New events slide in at the top and glow briefly; money events show the amount big and count up.
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Bot, ShoppingBag, Sparkles, Truck, User } from 'lucide-react';
import { EASE, SOFT_SPRING } from '../../components/motion';
import { Loading } from '../../components/ui';
import type { Actor, FeedEvent } from '../../types';
import { Counter } from './Counter';
import { relativeTime, useNow } from './hooks';

const MAX_EVENTS = 40;

const ACTOR: Record<Actor, { label: string; tone: string }> = {
  agent: { label: 'offload agent', tone: 'lv-tone-agent' },
  seller: { label: 'Seller', tone: 'lv-tone-seller' },
  runner: { label: 'Runner', tone: 'lv-tone-runner' },
  buyer: { label: 'Buyer', tone: 'lv-tone-buyer' },
};

function ActorIcon({ event }: { event: FeedEvent }) {
  const size = 22;
  switch (event.actor) {
    case 'agent':
      return <Sparkles size={size} aria-hidden />;
    case 'seller':
      return <User size={size} aria-hidden />;
    case 'runner':
      return <Truck size={size} aria-hidden />;
    default:
      // "Grok Bot offered £28..." gets a bot; a person buying gets a bag.
      return /\bbot\b/i.test(event.text) ? <Bot size={size} aria-hidden /> : <ShoppingBag size={size} aria-hidden />;
  }
}

export function Feed({
  events,
  isFresh,
  connected,
}: {
  events: FeedEvent[] | null;
  isFresh: (id: string) => boolean;
  connected: boolean; // false while polls are failing: the pill says so instead of claiming "Live"
}) {
  const now = useNow(10_000);
  const list = events ? events.slice(0, MAX_EVENTS) : null;

  return (
    <motion.section
      className="lv-panel lv-feed"
      aria-labelledby="lv-feed-title"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE, delay: 0.05 }}
    >
      <div className="lv-head">
        <div>
          <h2 id="lv-feed-title">The offload feed</h2>
          <p className="lv-head-sub">Everything the agent, sellers, runners and buyers do, as it happens.</p>
        </div>
        <span className={`lv-live-pill ${connected ? '' : 'is-off'}`}>
          <span className="lv-live-dot" aria-hidden /> {connected ? 'Live' : 'Reconnecting'}
        </span>
      </div>

      <div className="lv-feed-body">
        {list === null ? (
          <Loading label="Tuning in to the live room…" />
        ) : list.length === 0 ? (
          <div className="lv-empty">
            <Sparkles size={26} aria-hidden />
            <strong>Quiet for now.</strong>
            <p>Film a pile on the seller page and every step shows up here: the estimate, the pickup, the listings, the offers, the sales.</p>
          </div>
        ) : (
          <motion.div className="lv-feed-scroll" layoutScroll>
            <ol className="lv-feed-list" aria-live="polite" aria-relevant="additions">
              <AnimatePresence initial={true}>
                {list.map((e, i) => {
                  const fresh = isFresh(e.id);
                  const actor = ACTOR[e.actor] || ACTOR.agent;
                  return (
                    <motion.li
                      key={e.id}
                      layout="position"
                      className={`lv-event ${fresh ? 'is-fresh' : ''}`}
                      initial={{ opacity: 0, y: fresh ? -28 : 14, scale: fresh ? 0.97 : 1 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, transition: { duration: 0.25 } }}
                      transition={{ duration: fresh ? 0.6 : 0.5, ease: EASE, delay: fresh ? 0 : Math.min(i * 0.04, 0.5), layout: SOFT_SPRING }}
                    >
                      <span className={`lv-actor ${actor.tone}`}>
                        <ActorIcon event={e} />
                      </span>
                      <div className="lv-event-body">
                        <span className="lv-event-meta">
                          {actor.label} · <time dateTime={e.ts}>{relativeTime(e.ts, now)}</time>
                        </span>
                        <p className="lv-event-text">{e.text}</p>
                        {e.money != null ? (
                          <strong className="lv-event-money">
                            <Counter value={e.money} from={fresh ? 0 : undefined} delay={fresh ? 0.35 : 0} duration={1.1} />
                            <ArrowUpRight aria-hidden />
                          </strong>
                        ) : null}
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ol>
          </motion.div>
        )}
      </div>
    </motion.section>
  );
}
