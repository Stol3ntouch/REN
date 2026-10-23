'use client';

import { useSyncExternalStore } from 'react';

/**
 * Счётчики шапки и нижней панели: корзина, избранное, сравнение (GET /api/counters, T07).
 * Одно общее состояние на страницу: запрос при первом подписчике и после событий окна
 * 'rts:cart-changed' / 'rts:favorites-changed' / 'rts:compare-changed' (и при возврате на страницу из кэша).
 * Сбой сети оставляет прежние числа — шапка не ломается.
 */
export type Counters = { cart: number; favorites: number; compare: number };

const EMPTY: Counters = { cart: 0, favorites: 0, compare: 0 };
export const COUNTER_EVENTS = ['rts:cart-changed', 'rts:favorites-changed', 'rts:compare-changed'] as const;

let state: Counters = EMPTY;
let started = false;
let inflight = false;
let again = false;
const listeners = new Set<() => void>();

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

async function refresh(): Promise<void> {
  if (inflight) {
    again = true;
    return;
  }
  inflight = true;
  try {
    const res = await fetch('/api/counters', { credentials: 'same-origin', cache: 'no-store' });
    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      const next: Counters = { cart: num(body.cart), favorites: num(body.favorites), compare: num(body.compare) };
      if (next.cart !== state.cart || next.favorites !== state.favorites || next.compare !== state.compare) {
        state = next;
        for (const l of listeners) l();
      }
    }
  } catch {
    /* оставляем прежние числа */
  } finally {
    inflight = false;
    if (again) {
      again = false;
      void refresh();
    }
  }
}

function start(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  for (const name of COUNTER_EVENTS) window.addEventListener(name, () => void refresh());
  window.addEventListener('pageshow', () => void refresh());
  void refresh();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => listeners.delete(listener);
}

export function useCounters(): Counters {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}
