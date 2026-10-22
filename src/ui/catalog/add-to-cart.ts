/**
 * Тонкий адаптер «В корзину» для витрины. Контракт с T05 (корзина):
 *   POST /api/cart/items  { productId: number, qty: number }  (JSON, cookie гостя/сессии)
 *   2xx  → товар добавлен; тело игнорируется
 *   иначе → { error?: string | { message?: string }, message?: string } — показывается пользователю как есть
 * После успеха шлёт на window событие 'rts:cart-changed' (detail: { productId, qty }),
 * чтобы счётчик корзины в шапке мог обновиться. Сервер сам пересчитывает цену/наличие/количество.
 */
export type AddToCartResult = { ok: true } | { ok: false; message: string };

export const CART_ENDPOINT = '/api/cart/items';
export const CART_CHANGED_EVENT = 'rts:cart-changed';
export const MAX_QTY_PER_ITEM = 20;

function messageFrom(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { error?: unknown; message?: unknown };
  if (typeof b.message === 'string') return b.message;
  if (typeof b.error === 'string') return b.error;
  if (b.error && typeof b.error === 'object' && typeof (b.error as { message?: unknown }).message === 'string') {
    return (b.error as { message: string }).message;
  }
  return null;
}

export async function addToCart(productId: number, qty = 1, fetchImpl: typeof fetch = fetch): Promise<AddToCartResult> {
  try {
    const res = await fetchImpl(CART_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ productId, qty }),
    });
    if (res.ok) {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: { productId, qty } }));
      return { ok: true };
    }
    if (res.status === 404 || res.status === 405) return { ok: false, message: 'Корзина пока недоступна. Попробуйте позже.' };
    const body: unknown = await res.json().catch(() => null);
    return { ok: false, message: messageFrom(body) ?? 'Не удалось добавить товар в корзину. Попробуйте ещё раз.' };
  } catch {
    return { ok: false, message: 'Нет связи с сервером. Проверьте соединение и попробуйте ещё раз.' };
  }
}
