// A money number that counts to its new value, with an optional delay so a row of numbers can land one after another.
// The shared CountUp does the work: digits written straight to the DOM, whole pounds while counting (no "£5.93" on
// the way to £6), and screen readers only ever get the final value, so live regions stay quiet.
import { CountUp } from '../../components/motion';

export function Counter({
  value,
  from,
  delay = 0,
  duration = 1,
  format,
  className,
}: {
  value: number;
  from?: number; // start here on mount (e.g. 0 for a fresh sale); later changes count from the current number
  delay?: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}) {
  return <CountUp value={value} startFrom={from} delay={delay} duration={duration} format={format} className={className} />;
}
