import { useCallback, useEffect, useRef, useState } from 'react';

import { getMyRating, rateProduct } from '@/api';

export type MyRatingStatus =
  | 'loading' // loading the user's current rating
  | 'ready' // can rate (stars is 0 if they haven't yet)
  | 'saving'
  | 'saved'
  | 'failed' // the last rating couldn't be saved; stars are back to what they were
  | 'signed-out'; // the API says the user isn't signed in (e.g. their session expired)

export type MyRatingState = {
  /** The user's rating, 1 to 5, or 0 if they haven't rated the product. */
  stars: number;
  status: MyRatingStatus;
  /** Save a 1-5 star rating. The stars change right away and go back if saving fails. */
  rate: (stars: number) => void;
};

/**
 * The signed-in user's rating of a product: loads it, and saves a new one when they tap a star.
 * `onSaved` runs after each successful save, e.g. to reload the product's average.
 */
export function useMyRating(productId: number, onSaved?: () => void): MyRatingState {
  const [stars, setStars] = useState(0);
  const [status, setStatus] = useState<MyRatingStatus>('loading');
  // The last rating the server confirmed, to go back to if saving a new one fails.
  const savedStars = useRef(0);
  // Cancels the request in flight when the screen closes (or a newer rating replaces it).
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getMyRating(productId, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        savedStars.current = result.data.stars;
        setStars(result.data.stars);
        setStatus('ready');
      } else if (result.error.status === 401) {
        setStatus('signed-out');
      } else {
        // 404 means they haven't rated it. Any other problem: they can still rate it now.
        setStatus('ready');
      }
    });
    return () => {
      controller.abort();
      pending.current?.abort();
    };
  }, [productId]);

  const rate = useCallback(
    (next: number) => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      setStars(next);
      setStatus('saving');

      rateProduct(productId, next, { signal: controller.signal }).then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          savedStars.current = result.data.stars;
          setStars(result.data.stars);
          setStatus('saved');
          onSaved?.();
          return;
        }
        setStars(savedStars.current);
        setStatus(result.error.status === 401 ? 'signed-out' : 'failed');
      });
    },
    [productId, onSaved],
  );

  return { stars, status, rate };
}
