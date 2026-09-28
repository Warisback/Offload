// Money that counts up. The shared CountUp ticks in whole pounds and lands on the exact amount.
import { CountUp } from '../../components/motion';

export function Money({ value, startFrom, duration, className }: { value: number; startFrom?: number; duration?: number; className?: string }) {
  return <CountUp value={value} startFrom={startFrom} duration={duration} className={className} />;
}
