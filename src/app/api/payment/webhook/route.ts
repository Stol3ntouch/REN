import { processPaymentWebhook } from '@/integrations/payment/service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/payment/webhook — события платёжного провайдера.
 * Подпись: заголовок `x-rts-signature: sha256=<hex HMAC-SHA256(PAYMENT_WEBHOOK_SECRET, сырое тело)>`.
 * Без cookies и Origin-проверки (запрос от сервера провайдера); доверие — только подписи.
 * Ответы: 200 принято/повтор, 400 неизвестный платёж/заказ или несовпадение суммы, 401 неверная подпись, 500 сбой.
 */
export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  const res = await processPaymentWebhook(raw, req.headers);
  return Response.json(res.body, { status: res.status, headers: { 'cache-control': 'no-store' } });
}
