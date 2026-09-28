// The shared CountUp already hides the counting digits from assistive tech and keeps the real figure in an
// sr-only copy, so nobody hears "£43… £61…" or a £0 that hasn't scrolled into view yet.
import { CountUp } from '../../components/motion';

export const Count = CountUp;
