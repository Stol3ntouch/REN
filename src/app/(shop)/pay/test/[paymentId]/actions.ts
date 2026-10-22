'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { loadTestPayment, sendTestWebhook } from '@/integrations/payment/test-pay';
import { assertOrigin } from '@/server/http/origin';

/**
 * Кнопки «Успешно» / «Отказ» тестовой оплаты. Результат не ставится напрямую: действие отправляет подписанный
 * webhook в тот же обработчик, что и POST /api/payment/webhook. Доступ — владелец заказа или подписанная ссылка.
 */
export async function testPayAction(form: FormData): Promise<void> {
  assertOrigin({ method: 'POST', headers: await headers() });
  const paymentId = String(form.get('paymentId') ?? '');
  const token = String(form.get('t') ?? '') || null;
  const outcome = form.get('outcome') === 'success' ? 'success' : 'failure';
  const ctx = await loadTestPayment(paymentId, token);
  if (!ctx) redirect('/');

  // Повторное нажатие после результата ничего не делает (платёж уже не ожидает оплаты).
  if (ctx.payment.status === 'pending') await sendTestWebhook(ctx, outcome);

  // Возврат покупателя: страница заказа показывает статус из БД, а не результат нажатия.
  redirect(ctx.payment.returnUrl && ctx.payment.returnUrl.startsWith('/') && !ctx.payment.returnUrl.startsWith('//') ? ctx.payment.returnUrl : '/');
}
