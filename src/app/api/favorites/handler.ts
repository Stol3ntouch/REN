import { cookies } from 'next/headers';
import { z } from 'zod';
import { resolveOrCreateOwner, resolveOwner } from '@/domain/customers/session';
import { ValidationError, toErrorResponse } from '@/server/http/errors';
import { assertOrigin } from '@/server/http/origin';
import type { CookieStore, OwnerRef } from '@/server/http/owner';
import { clientIp, enforceRateLimit } from '@/server/http/rate-limit';

const NO_STORE = { 'cache-control': 'no-store' };

export const productIdBody = z.object({ productId: z.number({ error: 'Не указан товар' }).int('Некорректный товар').positive('Некорректный товар') });

/**
 * Общая обёртка обработчиков избранного и сравнения: Origin для небезопасных методов, лимит по IP,
 * владелец (пользователь по сессии, иначе гость; гость создаётся только при записи), JSON без кэша, ошибки через toErrorResponse.
 */
export async function handleOwnerRequest(
  req: Request,
  opts: { write: boolean; scope: string },
  run: (owner: OwnerRef | null, body: { productId: number } | undefined) => Record<string, unknown>,
): Promise<Response> {
  try {
    if (opts.write) assertOrigin(req);
    enforceRateLimit(`${opts.scope}:${clientIp(req.headers)}`, 300, 600);
    const jar = await cookies();
    const owner = opts.write ? resolveOrCreateOwner(jar as unknown as CookieStore) : resolveOwner(jar);
    let body: { productId: number } | undefined;
    if (opts.write) {
      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        throw new ValidationError('Некорректный запрос');
      }
      const parsed = productIdBody.safeParse(raw);
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Некорректный запрос');
      body = parsed.data;
    }
    return Response.json(run(owner, body), { headers: NO_STORE });
  } catch (e) {
    return toErrorResponse(e);
  }
}
