// "Your turn. Be the runner." Sits in the page title so it's on screen from the first second, top right of the projector.
// The QR opens /runner on a judge's phone (with the ?api= override, so it hits the same backend).
// Tap the code to blow it up full screen for scanning from the back of the room.
import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowUpRight, Maximize2, TriangleAlert, X } from 'lucide-react';
import { EASE, SPRING } from '../../components/motion';
import { isLocalOrigin, runnerLink } from '../../lib/config';
import { Overlay } from './Overlay';

const shortUrl = (u: string) => u.replace(/^https?:\/\//, '');
const hostAndPath = (u: string) => shortUrl(u).split('?')[0];

function LocalWarning() {
  return (
    <p className="lv-warn" role="note">
      <TriangleAlert size={15} aria-hidden />
      <span>Set VITE_PUBLIC_URL, phones can't open localhost.</span>
    </p>
  );
}

export function QrPanel() {
  const link = runnerLink();
  const local = isLocalOrigin(link);
  const [big, setBig] = useState(false);
  const close = useCallback(() => setBig(false), []);

  return (
    <motion.aside
      className="lv-qr"
      aria-labelledby="lv-qr-title"
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, ease: EASE, delay: 0.2 }}
    >
      <motion.button
        type="button"
        className="lv-qr-code"
        onClick={() => setBig(true)}
        aria-label="Show the runner QR code full screen"
        whileHover={{ y: -3, rotate: -1.5 }}
        whileTap={{ scale: 0.96 }}
        transition={SPRING}
      >
        <QRCodeSVG value={link} size={240} level="M" marginSize={0} title="QR code for the runner view" />
        <span className="lv-qr-expand" aria-hidden>
          <Maximize2 size={14} />
        </span>
      </motion.button>
      <div className="lv-qr-copy">
        <h2 id="lv-qr-title">Your turn. Be the runner.</h2>
        <p>Scan to open the runner view.</p>
        <Link to="/runner" className="lv-qr-url" title={link}>
          <span>{hostAndPath(link)}</span> <ArrowUpRight size={13} aria-hidden />
        </Link>
        {local ? <LocalWarning /> : null}
      </div>

      <Overlay open={big} onClose={close} label="Runner QR code" className="lv-qr-big">
        <button type="button" className="lv-overlay-close" onClick={close} aria-label="Close">
          <X size={22} aria-hidden />
        </button>
        <motion.div
          className="lv-qr-big-inner"
          initial={{ opacity: 0, y: 24, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, ease: EASE }}
        >
          <div className="lv-qr-big-code">
            <QRCodeSVG value={link} size={640} level="M" marginSize={0} title="QR code for the runner view" />
          </div>
          <div className="lv-qr-big-copy">
            <span className="eyebrow">YOUR TURN</span>
            <h2>Be the runner.</h2>
            <p>Point your phone camera here. The runner view opens, no app needed.</p>
            <small>{shortUrl(link)}</small>
            {local ? <LocalWarning /> : null}
          </div>
        </motion.div>
      </Overlay>
    </motion.aside>
  );
}
