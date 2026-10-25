import { cookies } from 'next/headers';
import { assertPricesShown } from '@/domain/content/store-flags';
import { z } from 'zod';
import { resolveOrCreateOwner, resolveOwner } from '@/domain/customers/session';
import type { CartView } from '@/domain/ordering';
import { ValidationError, toErrorResponse } from '@/server/http/errors';
import { assertOrigin } from '@/server/http/origin';
import type { CookieStore, OwnerRef } from '@/server/http/owner';
import { clientIp, enforceRateLimitByIp } from '@/server/http/rate-limit';

const NO_STORE = { 'cache-control': 'no-store' };

/** Тело запроса: JSON-объект; мусор → 400. */
async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ValidationError('Некорректный запрос');
  }
  const res = schema.safeParse(raw);
  if (!res.success) throw new ValidationError(res.error.issues[0]?.message ?? 'Некорректный запрос');
  return res.data;
}

export const productQtySchema = z.object({
  productId: z.number({ error: 'Не указан товар' }).int().positive(),
  qty: z.number({ error: 'Не указано количество' }).int('Количество — целое число'),
});
export const productIdSchema = z.object({ productId: z.number({ error: 'Не указан товар' }).int().positive() });
export const promoCodeSchema = z.object({ code: z.string({ error: 'Введите промокод' }).max(64) });

/**
 * Общая обёртка корзинных обработчиков: Origin (CSRF) для небезопасных методов, лимит по IP,
 * владелец (создаётся гость с httpOnly cookie rts_guest), JSON-ответ без кэша, ошибки через toErrorResponse.
 * Цены и суммы в ответе — серверные; клиентским значениям доверия нет.
 */
export async function handleCart<S extends z.ZodType>(
  req: Request,
  opts: { schema?: S; create?: boolean },
  run: (owner: OwnerRef | null, body: S extends z.ZodType ? z.infer<S> : undefined) => CartView | Record<string, unknown>,
): Promise<Response> {
  try {
    assertPricesShown(); // «Показывать цены» выключен → API корзины отвечает отказом
    const unsafe = !['GET', 'HEAD'].includes(req.method.toUpperCase());
    if (unsafe) assertOrigin(req);
    enforceRateLimitByIp('cart', clientIp(req.headers), 300, 600);
    const jar = await cookies();
    const owner = opts.create ? resolveOrCreateOwner(jar as unknown as CookieStore) : resolveOwner(jar);
    const body = (opts.schema ? await readJson(req, opts.schema) : undefined) as S extends z.ZodType ? z.infer<S> : undefined;
    return Response.json(run(owner, body), { headers: NO_STORE });
  } catch (e) {
    return toErrorResponse(e);
  }
}
