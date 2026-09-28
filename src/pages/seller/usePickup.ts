// Which pile this device is looking at: the one filmed here (myPickupId) if it's still in state,
// otherwise nothing (phone) or the latest pile (desktop). Rows the server just returned are kept
// locally only until the polled state has them, so the UI moves on before the next poll lands but a
// pile that's since been removed (demo reset) never lingers as a ghost.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppState } from '../../lib/state';
import { byCreated, itemsOf, myPickupId, pickupById, pickupJob, setMyPickupId } from '../../lib/selectors';
import type { AppState, Job, Pickup } from '../../types';

// The newest pile that actually has something in it (a video we couldn't read still creates an empty pile).
function latestWithItems(s: AppState): Pickup | null {
  const piles = s.pickups.filter((p) => p.preview.length > 0).sort(byCreated);
  return piles.at(-1) || null;
}

export function useSellerPickup({ fallbackToLatest }: { fallbackToLatest: boolean }) {
  const { state, error, upsert } = useAppState();
  const [mineId, setMineId] = useState<string | null>(() => myPickupId());
  const [created, setCreated] = useState<Pickup | null>(null);
  const [booked, setBooked] = useState<Job | null>(null);

  const inState = state ? pickupById(state, mineId) : null;
  const stateJob = state && booked ? pickupJob(state, booked.pickup_id) : null;

  // Once the server's state includes what we created or booked, the local copies have done their job.
  useEffect(() => {
    if (created && inState?.id === created.id) setCreated(null);
  }, [created, inState]);
  useEffect(() => {
    if (booked && stateJob) setBooked(null);
  }, [booked, stateJob]);

  const mine = inState || (created && created.id === mineId ? created : null);
  const latest = state ? latestWithItems(state) : null;
  const pickup = mine || (fallbackToLatest ? latest : null);
  const isMine = !!mine;
  const job = (state && pickup && pickupJob(state, pickup.id)) || (booked && pickup && booked.pickup_id === pickup.id ? booked : null);
  const items = useMemo(() => (state && pickup ? itemsOf(state, pickup.id) : []), [state, pickup]);
  // Waiting on the first poll for a pile we remember.
  const resolving = !state && !!mineId && !created;

  const adopt = useCallback(
    (p: Pickup) => {
      setMyPickupId(p.id);
      setMineId(p.id);
      setCreated(p);
      upsert('pickups', p);
    },
    [upsert],
  );

  const follow = useCallback((id: string | null) => {
    setMyPickupId(id);
    setMineId(id);
  }, []);

  const markBooked = useCallback(
    (j: Job) => {
      setBooked(j);
      upsert('jobs', j);
    },
    [upsert],
  );

  return { state, error, pickup, isMine, latest, job, items, resolving, adopt, follow, markBooked };
}
