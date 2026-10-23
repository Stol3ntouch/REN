import { handleWebhookRequest } from '@/integrations/payment/webhook-http';

export const dynamic = 'force-dynamic';

/**
 * POST /api/payment/webhook — события платёжного провайдера.
 * Подпись: заголовок `x-rts-signature: sha256=<hex HMAC-SHA256(PAYMENT_WEBHOOK_SECRET, сырое тело)>`.
 * Без cookies и Origin-проверки (запрос от сервера провайдера); доверие — только подписи.
 * Ответы: 200 принято/повтор, 400 неизвестный платёж/заказ или несовпадение суммы, 401 неверная подпись,
 * 413 тело больше 64 КБ, 429 слишком много неудач с одного IP, 500 сбой. Логика — в handleWebhookRequest.
 */
export async function POST(req: Request): Promise<Response> {
  return handleWebhookRequest(req);
}
