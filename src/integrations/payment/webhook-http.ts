import { isRateLimited, rateLimit, clientIp, UNKNOWN_IP } from '@/server/http/rate-limit';
import { getDb } from '@/server/db/connection';
import { logRun, MAX_WEBHOOK_BYTES, processPaymentWebhook, type ServiceOpts } from './service';

/** Неудачных запросов (подпись, неизвестный платёж, слишком большое тело) с одного IP за окно. */
export const WEBHOOK_FAILURE_LIMIT = 20;
export const WEBHOOK_FAILURE_WINDOW_SEC = 600;
/** Записей об отказах в журнал за окно на весь сайт: поток мусорных запросов не должен раздувать журнал. */
const REJECT_LOG_LIMIT = 60;

type Opts = ServiceOpts & { ip?: string };

const json = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}): Response =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...extra } });

/**
 * Читает тело не больше max байт. Заголовок content-length проверяется до чтения; фактический размер — по ходу чтения:
 * при превышении поток отменяется, остаток не буферизуется. null — тело слишком большое.
 */
async function readCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * HTTP-слой POST /api/payment/webhook: размер тела (413), лимит неудач по IP (429; при неизвестном IP не применяется),
 * журнал причин отказа без тела запроса. Разбор подписи и заказа — processPaymentWebhook.
 */
export async function handleWebhookRequest(req: Request, opts: Opts = {}): Promise<Response> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const ip = opts.ip ?? clientIp(req.headers);
  const key = `webhook:fail:${ip}`;
  const known = ip !== UNKNOWN_IP;

  if (known) {
    const st = isRateLimited(key, WEBHOOK_FAILURE_LIMIT, WEBHOOK_FAILURE_WINDOW_SEC, { db, now });
    if (st.limited) return json(429, { ok: false, error: 'Слишком много неудачных запросов' }, { 'retry-after': String(st.retryAfterSec) });
  }

  const fail = (code: string, message: string): void => {
    if (known) rateLimit(key, WEBHOOK_FAILURE_LIMIT, WEBHOOK_FAILURE_WINDOW_SEC, { db, now });
    if (rateLimit('webhook:reject-log', REJECT_LOG_LIMIT, WEBHOOK_FAILURE_WINDOW_SEC, { db, now }).allowed) {
      logRun({ kind: 'webhook', ok: false, code, message }); // только причина, тела запроса в журнале нет
    }
  };

  const raw = await readCapped(req, MAX_WEBHOOK_BYTES);
  if (raw === null) {
    fail('too_large', 'Тело webhook больше 64 КБ');
    return json(413, { ok: false, error: 'Слишком большое тело запроса' });
  }

  const res = await processPaymentWebhook(raw, req.headers, { ...opts, db, now });
  if (res.status === 401 || res.status === 400) fail(`rejected_${res.status}`, res.body.error ?? 'Запрос отклонён');
  return json(res.status, res.body);
}
