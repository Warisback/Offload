// Everything the runner screens need, derived from the polled state. Pure.
import type { AppState, Item, Job, Pickup } from '../../types';
import { itemById, itemsOf, pickupById, postJobs, runnerEarned, sameName } from '../../lib/selectors';
import { isPending } from './copy';

export interface RunnerView {
  earned: number;
  open: Job[]; // open pickup jobs anyone can take
  active: Job | null; // the pickup I'm working on right now
  otherActive: Job[]; // any further pickups I've accepted
  done: Job[]; // my finished pickups
  posts: Job[]; // post jobs for me (or open), not done
  postsDone: Job[];
}

// A pickup stays "mine to work on" until it's listed and nothing is left to photograph,
// or while I'm still looking at the grade of its last item.
export function isActiveJob(s: AppState, j: Job, resultId: string | null) {
  if (j.status === 'open') return false;
  if (j.status === 'accepted') return true;
  const p = pickupById(s, j.pickup_id);
  const items = itemsOf(s, j.pickup_id);
  if (resultId && items.some((i) => i.id === resultId)) return true;
  return (p ? p.status !== 'listed' : false) || items.some(isPending);
}

// preferred: the pickup the runner just accepted or switched to. It wins, so a leftover retake on an older pile
// (for example the seed data's "Sam") never hides the pickup they chose. Otherwise the one already underway wins.
export function deriveRunner(s: AppState, name: string, resultId: string | null, preferred: string | null = null): RunnerView {
  const pickupJobs = s.jobs.filter((j) => j.type === 'pickup');
  const mine = pickupJobs.filter((j) => sameName(j.runner_name, name));
  const activeAll = mine.filter((j) => isActiveJob(s, j, resultId));
  const rank = (j: Job) => (j.id === preferred ? 0 : j.status === 'done' ? 1 : 2);
  activeAll.sort((a, b) => rank(a) - rank(b));
  const posts = postJobs(s);
  return {
    earned: runnerEarned(s, name),
    open: pickupJobs.filter((j) => j.status === 'open'),
    active: activeAll[0] || null,
    otherActive: activeAll.slice(1),
    done: mine.filter((j) => j.status === 'done' && !activeAll.includes(j)),
    posts: posts.filter((j) => j.status !== 'done' && (sameName(j.runner_name, name) || j.status === 'open')),
    postsDone: posts.filter((j) => j.status === 'done' && sameName(j.runner_name, name)),
  };
}

export interface JobInfo {
  pickup: Pickup | null;
  items: Item[];
  labels: string[];
  count: number;
}

// Items for a job: the pickup's items (itemsOf), else the job's ids, else the estimate preview.
export function jobInfo(s: AppState, j: Job): JobInfo {
  const pickup = pickupById(s, j.pickup_id);
  let items = itemsOf(s, j.pickup_id);
  if (!items.length) items = j.item_ids.map((id) => itemById(s, id)).filter((i): i is Item => Boolean(i));
  const labels = items.length ? items.map((i) => i.label) : pickup?.preview.map((p) => p.label) || [];
  const count = items.length || j.item_ids.length || labels.length;
  return { pickup, items, labels, count };
}

export const postItemLabel = (s: AppState, j: Job) => itemById(s, j.item_ids[0])?.label || 'the sale';
