import { getConfig } from '@/server/config';
import { getDb } from '@/server/db/connection';
import { createManualDelivery } from './delivery/manual';
import type { DeliveryPort } from './delivery/types';
import { createFileOnecPort } from './onec/file-stub';
import type { OneCPort } from './onec/types';
import { getPaymentPort as selectPaymentPort, isProductionEnv } from './payment/select';
import type { PaymentPort } from './payment/types';
import type { PortStatus } from './types';

export type { PortStatus } from './types';
export type { PaymentPort, WebhookEvent } from './payment/types';
export type { DeliveryPort, DeliveryMethod } from './delivery/types';
export { registerPaymentProvider } from './payment/register';
export type { OneCPort } from './onec/types';

type Env = Record<string, string | undefined>;

/** Платёжный порт по env (PAYMENT_PROVIDER; в production тестовый провайдер недоступен). */
export function getPaymentPort(opts: { production?: boolean; env?: Env } = {}): PaymentPort {
  return selectPaymentPort(opts);
}

/** Доставка: пока только ручная («по согласованию с менеджером»). */
export function getDeliveryPort(): DeliveryPort {
  return createManualDelivery(getDb);
}

/** 1С: пока только файловая заглушка (data/onec-inbox, data/onec-outbox); реальной 1С нет. */
export function getOnecPort(opts: { dataDir?: string } = {}): OneCPort {
  return createFileOnecPort({ dataDir: opts.dataDir ?? getConfig().dataDir });
}

export type IntegrationStatusEntry = { key: 'payment' | 'delivery' | 'onec'; label: string; status: PortStatus };

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
    { key: 'onec', label: '1С', status: createFileOnecPort({ dataDir: '' }).status() },
  ];
}
