import { getDb } from '@/server/db/connection';
import { createManualDelivery } from './delivery/manual';
import type { DeliveryPort } from './delivery/types';
import { getPaymentPort as selectPaymentPort, isProductionEnv } from './payment/select';
import type { PaymentPort } from './payment/types';
import type { PortStatus } from './types';

export type { PortStatus } from './types';
export type { PaymentPort, WebhookEvent } from './payment/types';
export type { DeliveryPort, DeliveryMethod } from './delivery/types';
export { registerPaymentProvider } from './payment/register';

type Env = Record<string, string | undefined>;

/** Платёжный порт по env (PAYMENT_PROVIDER; в production тестовый провайдер недоступен). */
export function getPaymentPort(opts: { production?: boolean; env?: Env } = {}): PaymentPort {
  return selectPaymentPort(opts);
}

/** Доставка: пока только ручная («по согласованию с менеджером»). */
export function getDeliveryPort(): DeliveryPort {
  return createManualDelivery(getDb);
}

export type IntegrationStatusEntry = { key: 'payment' | 'delivery'; label: string; status: PortStatus };

/**
 * Статус портов для админки (T10 показывает вместе с onec/mail): «не подключено — заглушка».
 * Чистая функция: БД не трогает, секреты не возвращает.
 */
export function integrationsStatus(opts: { production?: boolean; env?: Env } = {}): IntegrationStatusEntry[] {
  const env = opts.env ?? process.env;
  const production = opts.production ?? isProductionEnv(env);
  return [
    { key: 'payment', label: 'Онлайн-оплата', status: selectPaymentPort({ production, env }).status() },
    { key: 'delivery', label: 'Доставка', status: createManualDelivery(getDb).status() },
  ];
}
