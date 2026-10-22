import { ConflictError } from '@/server/http/errors';
import type { Order } from './types';

/**
 * Шов между заказами (T05) и платёжным провайдером (T06). Заказы ничего не знают о провайдере:
 *  - после checkout.place() для способа оплаты kind='online' интерфейс вызывает startOnlinePayment(order);
 *    стартер создаёт платёж (PaymentPort.createPayment) и возвращает redirectUrl; нет стартера → null.
 *  - «Оплачен» / «ошибка оплаты» ставится ТОЛЬКО по проверенному webhook:
 *      orders.transition(orderId, 'paid' | 'payment_failed', { type: 'system', reason: 'webhook:<eventId>' }).
 *  - возврат (admin): orders.refund() вызывает возвратчик (PaymentPort.refund) с ключом идемпотентности
 *    `refund:<orderId>`, затем переводит заказ в «refunded».
 *
 * Регистрация провайдера: если стартер/возвратчик не заданы явно (setPaymentStarter/setPaymentRefunder),
 * при первом обращении лениво подгружается `@/integrations/payment/register`, который их регистрирует
 * (вне тестов — это и есть «подключение при старте приложения»). Состояние хранится на globalThis:
 * server actions и route handlers в Next собираются в разные бандлы.
 */
export type PaymentStarter = (order: Order) => Promise<{ redirectUrl: string } | null>;
export type PaymentRefunder = (order: Order, ctx: { idempotencyKey: string }) => Promise<void>;

type State = { starter: PaymentStarter | null; refunder: PaymentRefunder | null; bootstrapped: boolean; autoRegister: boolean };
const g = globalThis as unknown as { __rtsPaymentFlow?: State };
const state: State = (g.__rtsPaymentFlow ??= { starter: null, refunder: null, bootstrapped: false, autoRegister: true });

export function setPaymentStarter(impl: PaymentStarter | null): void {
  state.starter = impl;
}
export function setPaymentRefunder(impl: PaymentRefunder | null): void {
  state.refunder = impl;
}
/** Для тестов: отключить/включить ленивую авторегистрацию провайдера. */
export function setPaymentAutoRegister(enabled: boolean): void {
  state.autoRegister = enabled;
  if (!enabled) state.bootstrapped = false;
}

async function bootstrap(): Promise<void> {
  if (state.bootstrapped || !state.autoRegister) return;
  state.bootstrapped = true;
  try {
    const mod = await import('@/integrations/payment/register');
    mod.registerPaymentProvider();
  } catch {
    state.bootstrapped = false;
  }
}

export async function startOnlinePayment(order: Order): Promise<{ redirectUrl: string } | null> {
  if (order.payment.kind !== 'online') return null;
  if (!state.starter) await bootstrap();
  return state.starter ? state.starter(order) : null;
}

/** Всегда возвращает функцию: если провайдер ещё не зарегистрирован, она подгрузит его и при неудаче ответит 409. */
export function getPaymentRefunder(): PaymentRefunder | null {
  if (state.refunder) return state.refunder;
  if (!state.autoRegister) return null;
  return async (order, ctx) => {
    await bootstrap();
    if (!state.refunder) throw new ConflictError('Возврат через платёжную систему пока недоступен: оплата не подключена');
    return state.refunder(order, ctx);
  };
}
