import { useCallback, useRef } from 'react';
import { apiClient } from './apiClient';
import type { CartActionResponse } from '../types/database';

type Options = {
  // Show this quantity now (each tap, before the server answers).
  onShow: (productId: string, quantity: number) => void;
  // The server's own count, once it has caught up.
  onSettled: (productId: string, quantity: number) => void;
  // Something went wrong: reload from the server rather than guess.
  onError: (productId: string, error: unknown) => void;
};

// + and − change the number on screen straight away; the cart on the server
// catches up one request at a time, per product. Taps made while a request is
// on its way are added up, not dropped (they used to be ignored).
export function useCartStepper({ onShow, onSettled, onError }: Options) {
  const target = useRef<Record<string, number>>({});
  const confirmed = useRef<Record<string, number>>({});
  const running = useRef<Set<string>>(new Set());
  const callbacks = useRef({ onShow, onSettled, onError });
  callbacks.current = { onShow, onSettled, onError };

  const sync = useCallback(async (productId: string) => {
    running.current.add(productId);
    try {
      while (confirmed.current[productId] !== target.current[productId]) {
        const up = target.current[productId] > confirmed.current[productId];
        const before = confirmed.current[productId];
        const res = await apiClient.post<CartActionResponse>(`/cart/items/${productId}/${up ? 'increment' : 'decrement'}`);
        confirmed.current[productId] = res.data.quantity;
        // The server didn't move (no stock left, say): stop where it is.
        if (res.data.quantity === before) target.current[productId] = res.data.quantity;
      }
      callbacks.current.onSettled(productId, confirmed.current[productId]);
    } catch (err) {
      callbacks.current.onError(productId, err);
    } finally {
      running.current.delete(productId);
      delete target.current[productId];
    }
  }, []);

  // shown: the quantity on screen; max: how many can be had at most.
  const step = useCallback(
    (productId: string, shown: number, delta: 1 | -1, max = Number.MAX_SAFE_INTEGER) => {
      const busy = running.current.has(productId);
      const base = busy ? target.current[productId] : shown;
      const next = Math.min(Math.max(base + delta, 0), max);
      if (next === base) return;
      target.current[productId] = next;
      callbacks.current.onShow(productId, next);
      if (!busy) {
        confirmed.current[productId] = shown; // nothing on its way, so the screen is the server's count
        void sync(productId);
      }
    },
    [sync]
  );

  const isSyncing = useCallback((productId: string) => running.current.has(productId), []);

  return { step, isSyncing };
}
