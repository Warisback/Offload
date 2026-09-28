// /runner: phone layout under 768px (judges scan the QR and do the pickup), desktop layout above it.
// The session sits above the switch so rotating a phone mid-pickup never loses photos, focus or a running upload.
import './runner.css';
import { useIsPhone, useTitle } from '../components/ui';
import { RunnerSession } from './runner/session';
import { RunnerPhone } from './runner/RunnerPhone';
import { RunnerDesktop } from './runner/RunnerDesktop';

function Layout() {
  const phone = useIsPhone();
  return phone ? <RunnerPhone /> : <RunnerDesktop />;
}

export default function Runner() {
  useTitle('Runner');
  return (
    <RunnerSession>
      <Layout />
    </RunnerSession>
  );
}
