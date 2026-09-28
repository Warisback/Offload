import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Footer, Header, ButtonLink, useTitle } from '../components/ui';

export default function NotFound() {
  useTitle('Not found');
  return (
    <>
      <Header />
      <main className="workspace not-found" id="main">
        <span className="eyebrow">NOTHING HERE</span>
        <h1 tabIndex={-1}>This page has moved on.</h1>
        <p>Like a good jacket, it found somewhere else to be. Let's get you back.</p>
        <div className="not-found-actions">
          <ButtonLink to="/">Back home</ButtonLink>
          <Link className="text-link" to="/seller"><ArrowLeft size={16} aria-hidden /> My wardrobe</Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
