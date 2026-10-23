/**
 * Клиентское состояние «избранное / сравнение» для кнопок на карточках и странице товара.
 * Один общий запрос GET /api/counters?ids=1 на страницу (повтор не чаще раза в 3 с), дальше — ответы POST/DELETE.
 * Источник истины — сервер (cookie rts_guest или сессия); здесь только копия для подсветки кнопок.
 * События окна для шапки (T08): 'rts:favorites-changed' и 'rts:compare-changed', detail: { count, ids }.
 */
export type CollectionKind = 'favorites' | 'compare';

export const FAVORITES_CHANGED_EVENT = 'rts:favorites-changed';
export const COMPARE_CHANGED_EVENT = 'rts:compare-changed';

export type Snapshot = { loaded: boolean; favorites: ReadonlySet<number>; compare: ReadonlySet<number> };
export type MutateResult = { ok: true } | { ok: false; message: string };

const EMPTY: Snapshot = { loaded: false, favorites: new Set(), compare: new Set() };
const STALE_MS = 3000;

let state: Snapshot = EMPTY;
let lastFetch = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Snapshot): void {
  state = next;
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const getSnapshot = (): Snapshot => state;
export const getServerSnapshot = (): Snapshot => EMPTY;

function messageFrom(body: unknown, fallback: string): string {
  const m = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof m === 'string' ? m : fallback;
}

/** Подтянуть состояние с сервера (не чаще раза в 3 с, если не force). Ошибка сети молча оставляет прежнее состояние. */
export function refresh(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && state.loaded && Date.now() - lastFetch < STALE_MS) return Promise.resolve();
  inflight = (async () => {
    try {
      const res = await fetch('/api/counters?ids=1', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { favoriteIds?: number[]; compareIds?: number[] };
      lastFetch = Date.now();
      set({ loaded: true, favorites: new Set(body.favoriteIds ?? []), compare: new Set(body.compareIds ?? []) });
    } catch {
      /* нет связи — кнопки остаются в прежнем состоянии, действие по клику сообщит об ошибке */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Включить/выключить товар в избранном или сравнении. Понятное сообщение сервера (например, лимит 4) возвращается как есть. */
export async function mutate(kind: CollectionKind, productId: number, on: boolean): Promise<MutateResult> {
  try {
    const res = await fetch(`/api/${kind === 'favorites' ? 'favorites' : 'compare'}`, {
      method: on ? 'POST' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ productId }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: messageFrom(body, 'Не удалось выполнить действие. Попробуйте ещё раз.') };
    const ids = (body as { ids?: number[] }).ids ?? [];
    lastFetch = Date.now();
    set({ ...state, loaded: true, [kind]: new Set(ids) });
    window.dispatchEvent(new CustomEvent(kind === 'favorites' ? FAVORITES_CHANGED_EVENT : COMPARE_CHANGED_EVENT, { detail: { count: ids.length, ids } }));
    return { ok: true };
  } catch {
    return { ok: false, message: 'Нет связи с сервером. Проверьте соединение и попробуйте ещё раз.' };
  }
}
