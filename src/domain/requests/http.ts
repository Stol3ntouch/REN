import { parseCookieHeader } from '@/domain/admin/guard';
import { resolveOwner } from '@/domain/customers/session';
import type { Db } from '@/server/db/connection';
import { AppError, NotFoundError, toErrorResponse, ValidationError } from '@/server/http/errors';
import { assertOrigin } from '@/server/http/origin';
import { clientIp } from '@/server/http/rate-limit';
import { submitCallback, submitContact, submitQuestion, submitRepair, submitReview, type SubmitCtx, type SubmitResult } from './service';

const HANDLERS: Record<string, (input: unknown, ctx: SubmitCtx) => Promise<SubmitResult>> = {
  repair: submitRepair,
  callback: submitCallback,
  contact: submitContact,
  question: submitQuestion,
  review: submitReview,
};

const MAX_BODY_CHARS = 20_000;

/**
 * Общий обработчик POST /api/forms/<repair|callback|contact|question|review>:
 * Origin → размер и JSON → форма → submit* (honeypot, zod, лимит по IP, запись, согласие, письмо).
 * 201 {ok:true, number}; ошибки — JSON {error:{code,message,fields?}} (400/403/404/413/429).
 */
export async function handleFormRequest(kind: string, req: Request, deps: { db?: Db; now?: number } = {}): Promise<Response> {
  try {
    assertOrigin(req);
    const submit = Object.hasOwn(HANDLERS, kind) ? HANDLERS[kind] : undefined;
    if (!submit) throw new NotFoundError('Форма не найдена');

    const raw = await req.text();
    if (raw.length > MAX_BODY_CHARS) throw new AppError('Слишком большой запрос', 413, 'payload_too_large');
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ValidationError('Не удалось прочитать данные формы');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Не удалось прочитать данные формы');

    const owner = resolveOwner(parseCookieHeader(req.headers.get('cookie')), { db: deps.db, now: deps.now });
    const res = await submit(body, { db: deps.db, now: deps.now, ip: clientIp(req.headers), owner });
    return Response.json({ ok: true, number: res.number }, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return toErrorResponse(e);
  }
}
