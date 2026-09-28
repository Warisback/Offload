// The landing page: the offload story in one scroll. Motion follows the money: the headline lands, the pile gets
// an estimate, the jacket sells, and the split fills in. Everything settles to a readable static page with reduced motion.
import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import {
  AnimatePresence,
  PresenceContext,
  motion,
  useAnimate,
  useInView,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
  type Variants,
} from 'motion/react';
import { ArrowUpRight, Check, CircleCheck, Play, ScanLine, ShieldCheck, Sparkles, Truck } from 'lucide-react';
import { ButtonLink, Footer, Header, useIsPhone, useTitle } from '../components/ui';
import { CountUp, EASE, Reveal, SOFT_SPRING, SPRING, Stagger, press, rise } from '../components/motion';
import { useAppState } from '../lib/state';
import { sellerEarned } from '../lib/selectors';
import { formatMoney, splitSale } from '../lib/money';
import { USE_MOCK } from '../lib/config';
import type { LivePrompt } from '../types';
import './landing.css';

const HERO_PHOTO = '/images/hero.jpg';
const HERO_PHOTO_SMALL = '/images/hero-640.jpg'; // phones and 1x laptops
const STAR = '✳︎'; // the ✳ motif, forced to text so iOS never swaps in the emoji
const EXAMPLE = splitSale(3800); // the £38 jacket, split the same way the backend's ledger does it
const PROMISE = ['YOU FILM.', 'WE COLLECT.', 'WE SELL.', 'YOU GET PAID.'];
// Real prompts from POST /api/live/frame, cycled in the "film it" step.
const CAM_PROMPTS: readonly LivePrompt[] = ['Show me the label', 'Turn it round', 'Any marks or damage?', 'Anything special about it?'];

// An estimate is a range of whole pounds: count in pounds so pennies never flicker past ("£45.23").
const wholePounds = (pence: number) => formatMoney(Math.round(pence / 100) * 100);

const enter = (delay: number, y = 18) => ({
  initial: { opacity: 0, y },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, ease: EASE, delay },
});
const inViewOnce = { once: true, margin: '-40px' } as const;

export default function Landing() {
  useTitle('');
  return (
    // main.tsx wraps routes in <AnimatePresence initial={false}>, which tells every nested motion component to skip its
    // entrance on a first page load. Clearing the presence context here lets the landing choreography play on direct visits.
    <PresenceContext.Provider value={null}>
      <div className="ld-page">
        <ScrollProgress />
        <Header landing />
        <main id="main">
          <Hero />
          <PromiseStrip />
          <HowItWorks />
          <YourCut />
          <Closing />
        </main>
        <Footer />
      </div>
    </PresenceContext.Provider>
  );
}

// A thin periwinkle line that fills as you read down the page.
function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 200, damping: 40, mass: 0.3 });
  return <motion.div className="ld-progress" style={{ scaleX, originX: 0 }} aria-hidden />;
}

// ---------- hero ----------

type Parallax = Record<'photo' | 'orb' | 'est' | 'sold' | 'stamp', MotionValue<number>>;

// As the hero scrolls away the photo lags behind and the cards lift towards you: depth without a gimmick.
// On phones the art sits below the copy, so it is watched mid-scroll: keep the shift small there or the
// sold card would slide up over her face.
function useHeroParallax(target: RefObject<HTMLElement | null>): Parallax {
  const phone = useIsPhone();
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target, offset: ['start start', 'end start'] });
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.35 });
  const k = reduce ? 0 : phone ? 0.3 : 1;
  return {
    photo: useTransform(p, (v) => v * 70 * k),
    orb: useTransform(p, (v) => 1 + v * 0.12 * k),
    est: useTransform(p, (v) => v * -90 * k),
    sold: useTransform(p, (v) => v * -110 * k),
    stamp: useTransform(p, (v) => v * 60 * k),
  };
}

function Hero() {
  const ref = useRef<HTMLElement>(null);
  const px = useHeroParallax(ref);
  return (
    <section className="hero ld-hero" ref={ref}>
      <div className="hero-copy">
        <motion.div className="eyebrow" {...enter(0.05, 10)}>
          <motion.span
            className="mini-mark"
            aria-hidden
            initial={{ rotate: -90, scale: 0.4 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ ...SPRING, delay: 0.2 }}
          >
            ↗
          </motion.span>
          THE LIGHTER WAY TO SELL
        </motion.div>
        <Headline />
        <motion.p {...enter(0.42)}>
          That pile of clothes? It’s money waiting to happen.
          <br className="desktop-break" /> Film it. We collect it, sell it, and pay you.
          <br className="desktop-break" /> You get on with your life.
        </motion.p>
        <motion.div className="hero-actions" {...enter(0.52)}>
          <ButtonLink to="/seller">Offload your first pile</ButtonLink>
          <motion.span className="ld-link-wrap" {...press}>
            <Link className="text-link" to="/live">
              <span className="play-icon ld-play">
                <Play size={12} fill="currentColor" aria-hidden />
              </span>
              See it in action
            </Link>
          </motion.span>
        </motion.div>
        <motion.div className="hero-reassurance" {...enter(0.62)}>
          <span>
            <Check size={15} aria-hidden /> No listing. No haggling.
          </span>
          <span>
            <Check size={15} aria-hidden /> You keep 70%.
          </span>
        </motion.div>
        <LiveProof />
        <motion.div className="hero-bottom ld-hero-bottom" {...enter(0.78, 8)}>
          <motion.span
            className="line"
            style={{ originX: 0 }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.95, duration: 0.8, ease: EASE }}
          />
          <span>GOOD CLOTHES. NEXT CHAPTER.</span>
        </motion.div>
      </div>
      <HeroArt px={px} />
    </section>
  );
}

// Words rise out of their own line one after another, then the hand-drawn underline draws itself under "life."
function Headline() {
  return (
    <h1 tabIndex={-1} className="ld-title">
      <Word i={0}>Less</Word> <Word i={1}>wardrobe.</Word>
      <br />
      <Word i={2}>More</Word>{' '}
      <span className="life">
        <Word i={3}>life.</Word>
        <svg viewBox="0 0 190 20" aria-hidden="true">
          <motion.path
            d="M3 12Q80-2 184 7"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ pathLength: { delay: 0.95, duration: 0.7, ease: EASE }, opacity: { delay: 0.95, duration: 0.05 } }}
          />
          <motion.path
            d="M16 18Q100 8 171 14"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ pathLength: { delay: 1.35, duration: 0.55, ease: EASE }, opacity: { delay: 1.35, duration: 0.05 } }}
          />
        </svg>
      </span>
    </h1>
  );
}

function Word({ i, children }: { i: number; children: string }) {
  return (
    <span className="ld-mask">
      <motion.span
        className="ld-word"
        initial={{ y: '118%', opacity: 0 }}
        animate={{ y: '0%', opacity: 1 }}
        transition={{ delay: 0.12 + i * 0.09, duration: 0.85, ease: EASE }}
      >
        {children}
      </motion.span>
    </span>
  );
}

// "£X earned for sellers so far", straight from the ledger. Only there when something has actually sold.
function LiveProof() {
  const { state } = useAppState();
  const earned = state ? sellerEarned(state) : 0;
  const sold = state ? state.ledger.length : 0;
  const show = sold > 0 && earned > 0;
  // A sale lands during the demo: the number counts up (CountUp) and gets one small green beat.
  const [scope, animate] = useAnimate<HTMLElement>();
  const prev = useRef(earned);
  useEffect(() => {
    const grew = prev.current > 0 && earned > prev.current;
    prev.current = earned;
    if (grew && scope.current) {
      animate(scope.current, { scale: [1, 1.14, 1], color: ['#171918', '#2f7a4b', '#171918'] }, { duration: 0.9, ease: EASE });
    }
  }, [earned, animate, scope]);
  return (
    <div className="ld-proof-slot">
      <AnimatePresence>
        {show ? (
          <motion.div
            key="proof"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.5, ease: EASE, delay: 0.3 }}
          >
            <Link to="/live" className="ld-proof">
              <span className="ld-proof-dot" aria-hidden />
              <span>
                <strong ref={scope}>
                  <CountUp value={earned} startFrom={0} duration={1.2} />
                </strong>{' '}
                earned for sellers so far
                <span className="ld-proof-sold">
                  {' '}
                  · {sold} {sold === 1 ? 'piece' : 'pieces'} sold
                </span>
                {USE_MOCK ? <span className="ld-proof-demo"> · demo data</span> : null}
              </span>
              <ArrowUpRight size={15} aria-hidden />
            </Link>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function HeroArt({ px }: { px: Parallax }) {
  const reduce = Boolean(useReducedMotion());
  // The estimate starts counting once its card has arrived (with reduced motion it simply shows the range).
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 750);
    return () => clearTimeout(t);
  }, []);
  const low = armed || reduce ? 8500 : 4000;
  const high = armed || reduce ? 12000 : 6000;
  // Each card floats on its own slow rhythm (a CSS animation on the compositor, see .ld-card in landing.css),
  // while the motion wrappers around them carry the entrance and the scroll parallax.

  return (
    <div className="hero-art">
      <motion.div className="art-label" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2, duration: 0.8 }}>
        YOUR WARDROBE, ON THE MOVE.
      </motion.div>

      <motion.div
        className="ld-orb"
        aria-hidden
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ...SOFT_SPRING, delay: 0.05 }}
      >
        <motion.span style={{ scale: px.orb }} />
      </motion.div>

      <motion.div
        className="hero-photo"
        style={{ y: px.photo }}
        initial={{ opacity: 0, rotate: 11, scale: 0.9 }}
        animate={{ opacity: 1, rotate: 4, scale: 1 }}
        transition={{ default: { type: 'spring', stiffness: 90, damping: 15, delay: 0.18 }, opacity: { duration: 0.6, delay: 0.18 } }}
      >
        <motion.img
          src={HERO_PHOTO}
          srcSet={`${HERO_PHOTO_SMALL} 640w, ${HERO_PHOTO} 1200w`}
          sizes="(max-width: 767px) 72vw, 34vw"
          alt="A smiling woman in a light denim jacket walking down a sunny, tree-lined street"
          width={1200}
          height={1800}
          fetchPriority="high"
          initial={{ scale: 1.18 }}
          animate={{ scale: 1 }}
          transition={{ duration: 1.8, ease: EASE, delay: 0.18 }}
        />
        <motion.div className="photo-top" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1, duration: 0.6 }}>
          <span>PRELOVED. RELOVED.</span>
          <ArrowUpRight size={25} aria-hidden />
        </motion.div>
        <motion.div className="photo-caption" {...enter(1.05, 14)}>
          Great clothes deserve
          <br />
          another good story.
        </motion.div>
      </motion.div>

      <motion.div
        className="ld-float ld-float-est"
        style={{ y: px.est }}
        initial={{ opacity: 0, x: -48, scale: 0.9 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ ...SOFT_SPRING, delay: 0.6 }}
      >
        <div className="ld-card ld-card-est">
          <span className="float-icon ld-scan">
            <ScanLine size={21} aria-hidden />
          </span>
          <div>
            <small>Your pile has potential</small>
            <strong>
              <CountUp value={low} startFrom={reduce ? 8500 : 4000} format={wholePounds} duration={1.3} />–
              <CountUp value={high} startFrom={reduce ? 12000 : 6000} format={wholePounds} duration={1.3} />
            </strong>
            <span className="ld-card-sub">6 pieces. One fresh start.</span>
          </div>
          <span className="tiny-star ld-spin" aria-hidden>
            {STAR}
          </span>
        </div>
      </motion.div>

      <motion.div
        className="ld-float ld-float-sold"
        style={{ y: px.sold }}
        initial={{ opacity: 0, x: 36, scale: 0.88 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ ...SOFT_SPRING, delay: 0.9 }}
      >
        <div className="ld-card ld-card-sold">
          <span className="sold-icon">
            <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <motion.path d="M4.5 12.5l5 5L20 7" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 1.35, duration: 0.5, ease: EASE }} />
            </svg>
          </span>
          <div>
            <strong>That jacket? Sold.</strong>
            <small>{formatMoney(EXAMPLE.seller)} coming your way.</small>
          </div>
          <ArrowUpRight size={18} aria-hidden />
        </div>
      </motion.div>

      <motion.div className="ld-stamp-pos" style={{ y: px.stamp }} aria-hidden>
        <motion.div
          className="ld-stamp"
          initial={{ opacity: 0, scale: 0.3, rotate: -120 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ ...SOFT_SPRING, delay: 1.0 }}
        >
          <StampRing />
        </motion.div>
      </motion.div>
    </div>
  );
}

// The round stamp: its words run round the edge and turn slowly (CSS, on the compositor); the arrow stays put.
function StampRing() {
  const r = 37;
  const circle = `M50 50m-${r} 0a${r} ${r} 0 1 1 ${2 * r} 0a${r} ${r} 0 1 1 -${2 * r} 0`;
  return (
    <>
      <svg className="ld-stamp-ring" viewBox="0 0 100 100">
        <defs>
          <path id="ld-stamp-circle" d={circle} />
        </defs>
        <text>
          <textPath href="#ld-stamp-circle" textLength={Math.floor(2 * Math.PI * r) - 7} lengthAdjust="spacing">
            {`LESS STUFF ${STAR} MORE POSSIBLE ${STAR}`}
          </textPath>
        </text>
      </svg>
      <ArrowUpRight className="ld-stamp-arrow" size={31} />
    </>
  );
}

// ---------- promise strip ----------

// An endless, slow marquee. Pauses on hover; with reduced motion it's a still row.
function PromiseStrip() {
  const reduce = useReducedMotion();
  const sequence = (
    <>
      {PROMISE.map((p, i) => (
        <Fragment key={p}>
          <span>{p}</span>
          {i < PROMISE.length - 1 ? <span className="ld-strip-arrow">↗</span> : <span className="ld-strip-star">{STAR}</span>}
        </Fragment>
      ))}
    </>
  );
  if (reduce) {
    return (
      <div className="ld-strip ld-strip-static">
        <p className="sr-only">You film. We collect. We sell. You get paid.</p>
        <div className="ld-strip-row" aria-hidden>
          {sequence}
        </div>
      </div>
    );
  }
  const group = (key: string) => (
    <div className="ld-strip-group" key={key}>
      {[0, 1, 2].map((n) => (
        <Fragment key={n}>{sequence}</Fragment>
      ))}
    </div>
  );
  return (
    <div className="ld-strip">
      <p className="sr-only">You film. We collect. We sell. You get paid.</p>
      <div className="ld-strip-viewport" aria-hidden>
        <div className="ld-strip-track">
          {group('a')}
          {group('b')}
        </div>
      </div>
    </div>
  );
}

// ---------- how it works ----------

function HowItWorks() {
  return (
    <section className="how section" id="how-it-works">
      <Reveal className="section-heading">
        <div>
          <span className="eyebrow">A CLEAR-OUT WITHOUT THE CHORE</span>
          <h2>
            <span className="ld-line">Your part takes a minute.</span>
            <span className="ld-line">We take it from there.</span>
          </h2>
        </div>
        <p>
          From the back of your wardrobe
          <br />
          to someone’s new favourite.
        </p>
      </Reveal>
      <div className="steps">
        <Step i={0}>
          <motion.div className="step-visual lavender" whileHover={{ y: -6 }} transition={SPRING}>
            <motion.div
              className="mini-camera"
              initial={{ y: 150, rotate: 0, opacity: 0 }}
              whileInView={{ y: 31, rotate: -7, opacity: 1 }}
              viewport={inViewOnce}
              transition={{ ...SOFT_SPRING, delay: 0.2 }}
            >
              <ScanLine size={62} strokeWidth={1} aria-hidden />
              <span>Tell us its story.</span>
              <span className="mini-record ld-rec" />
            </motion.div>
            <CamPrompt />
            <span className="step-number">01</span>
          </motion.div>
          <h3>Film it. Talk us through it.</h3>
          <p>Show us your pile and tell us a little about it. Get an estimate before you commit.</p>
        </Step>

        <Step i={1}>
          <motion.div className="step-visual peach" whileHover={{ y: -6 }} transition={SPRING}>
            <motion.div
              className="pickup-mini"
              initial={{ x: -140, rotate: 4, opacity: 0 }}
              whileInView={{ x: 0, rotate: -5, opacity: 1 }}
              viewport={inViewOnce}
              transition={{ ...SOFT_SPRING, delay: 0.3 }}
            >
              <span className="icon-disc ld-truck">
                <Truck size={26} aria-hidden />
              </span>
              <div>
                <strong>Your runner is on the way</strong>
                <small>Collected from your doorstep</small>
              </div>
              <motion.span
                className="ld-shield"
                initial={{ scale: 0 }}
                whileInView={{ scale: 1 }}
                viewport={inViewOnce}
                transition={{ ...SPRING, delay: 0.85 }}
              >
                <ShieldCheck size={21} aria-hidden />
              </motion.span>
            </motion.div>
            <span className="ld-route" aria-hidden>
              <span />
            </span>
            <span className="step-number">02</span>
          </motion.div>
          <h3>Hand it over. Hands off.</h3>
          <p>A vetted local runner collects and photographs your pieces. We handle the listings and buyers.</p>
        </Step>

        <Step i={2}>
          <motion.div className="step-visual mint" whileHover={{ y: -6 }} transition={SPRING}>
            <motion.div
              className="payout-mini"
              initial={{ y: 100, rotate: -6, opacity: 0 }}
              whileInView={{ y: 0, rotate: 4, opacity: 1 }}
              viewport={inViewOnce}
              transition={{ ...SOFT_SPRING, delay: 0.4 }}
            >
              <span>YOUR WARDROBE, WORKING FOR YOU</span>
              <strong>
                <span>
                  + <CountUp value={EXAMPLE.seller} startFrom={0} duration={1.4} />
                </span>
                <ArrowUpRight size={32} aria-hidden />
              </strong>
              <small>
                <CircleCheck size={14} aria-hidden /> Another piece, another payday.
              </small>
            </motion.div>
            <span className="step-number">03</span>
          </motion.div>
          <h3>Make space. Get paid.</h3>
          <p>We find a buyer and handle the post. You keep 70% of every sale, without the to-do list.</p>
        </Step>
      </div>
    </section>
  );
}

// Each step reveals when it reaches the screen. Side by side on desktop they cascade left to right; stacked on a
// phone each one waits for its own turn instead of animating unseen below the fold.
const stepIn: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: (delay: number) => ({ opacity: 1, y: 0, transition: { duration: 0.65, ease: EASE, delay } }),
};

function Step({ i, children }: { i: number; children: ReactNode }) {
  const phone = useIsPhone();
  return (
    <motion.article variants={stepIn} custom={phone ? 0 : i * 0.12} initial="hidden" whileInView="show" viewport={inViewOnce}>
      {children}
    </motion.article>
  );
}

// The prompt bubble the seller sees while filming, cycling through the real prompts while it's on screen.
function CamPrompt() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: '-40px' });
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!inView || reduce) return;
    const t = setInterval(() => setI((n) => (n + 1) % CAM_PROMPTS.length), 2600);
    return () => clearInterval(t);
  }, [inView, reduce]);
  return (
    <motion.div
      ref={ref}
      className="ld-cam-prompt"
      aria-hidden
      initial={{ opacity: 0, scale: 0.8, y: 10 }}
      whileInView={{ opacity: 1, scale: 1, y: 0 }}
      viewport={inViewOnce}
      transition={{ ...SPRING, delay: 0.7 }}
    >
      <Sparkles size={14} />
      {/* Every prompt sits invisibly in the same grid cell, so the bubble is sized once for the longest and never
          jumps in width as the prompts change. */}
      <span className="ld-cam-text">
        {CAM_PROMPTS.map((p) => (
          <span key={p} className="ld-cam-sizer">
            {p}
          </span>
        ))}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: EASE }}
          >
            {CAM_PROMPTS[i]}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.div>
  );
}

// ---------- your cut ----------

const barParent: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.14, delayChildren: 0.25 } } };
const barSegment: Variants = { hidden: { scaleX: 0 }, show: { scaleX: 1, transition: { duration: 0.9, ease: EASE } } };

function YourCut() {
  const { sale, seller, runner, ours } = EXAMPLE;
  return (
    <section className="split-section section" id="your-cut">
      <Stagger inView gap={0.1}>
        <motion.span className="eyebrow" variants={rise}>
          FAIR, FROM THE FIRST SALE
        </motion.span>
        <motion.h2 variants={rise}>
          <span className="ld-line">It’s your wardrobe.</span>
          <span className="ld-line">You get the biggest cut.</span>
        </motion.h2>
        <motion.p variants={rise}>
          No upfront fee. No surprise deductions.
          <br />
          Here’s how a {formatMoney(sale)} jacket sale breaks down.
        </motion.p>
        <motion.div variants={rise}>
          <ButtonLink to="/seller">Sounds good? Let’s offload.</ButtonLink>
        </motion.div>
      </Stagger>

      <Reveal className="split-card ld-split-card" y={32}>
        <div className="split-title">
          <span>ONE JACKET. EVERYONE WINS.</span>
          <ArrowUpRight aria-hidden />
        </div>
        <div className="seller-cut">
          <span>You keep</span>
          <strong>
            <CountUp value={seller} startFrom={0} duration={1.3} />
          </strong>
          <span>70% · yours, for doing less</span>
        </div>
        <motion.div
          className="split-bar"
          role="img"
          aria-label={`Of a ${formatMoney(sale)} sale: you get ${formatMoney(seller)}, the runner ${formatMoney(runner)}, offload ${formatMoney(ours)}.`}
          variants={barParent}
          initial="hidden"
          whileInView="show"
          viewport={inViewOnce}
        >
          <motion.i variants={barSegment} style={{ originX: 0, flex: `${seller} 1 0` }} />
          <motion.i variants={barSegment} style={{ originX: 0, flex: `${runner} 1 0` }} />
          <motion.i variants={barSegment} style={{ originX: 0, flex: `${Math.max(ours, 0)} 1 0` }} />
        </motion.div>
        <div className="split-details">
          <div>
            <span>
              <i className="swatch black" />
              Your runner
            </span>
            <strong>
              <CountUp value={runner} startFrom={0} duration={1.1} />
            </strong>
            <small>Collection + posting</small>
          </div>
          <div>
            <span>
              <i className="swatch pale" />
              offload
            </span>
            <strong>
              <CountUp value={ours} startFrom={0} duration={1.1} />
            </strong>
            <small>Everything in between</small>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

// ---------- closing ----------

function Closing() {
  return (
    <section className="closing section ld-closing">
      <Stagger inView gap={0.12}>
        <motion.span className="eyebrow" variants={rise}>
          LET GOOD THINGS GO SOMEWHERE
        </motion.span>
        <motion.h2 variants={rise}>
          <span className="ld-line">That “I’ll sell it” pile?</span>
          <span className="ld-line">
            Let’s make it happen.
            <span className="ld-closing-arrow" aria-hidden>
              <ArrowUpRight />
            </span>
          </span>
        </motion.h2>
        <motion.div variants={rise}>
          <ButtonLink to="/seller">Start offloading</ButtonLink>
        </motion.div>
      </Stagger>
    </section>
  );
}
