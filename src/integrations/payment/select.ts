import { randomBytes } from 'node:crypto';
import { ConflictError } from '@/server/http/errors';
import type { PortStatus } from '../types';
import { createTestPaymentProvider } from './test-provider';
import { PaymentUnavailableError, type PaymentPort } from './types';

type Env = Record<string, string | undefined>;

/** Production: NODE_ENV=production или APP_ENV=production. */
export function isProductionEnv(env: Env = process.env): boolean {
  return env.NODE_ENV === 'production' || env.APP_ENV === 'production';
}

const g = globalThis as unknown as { __rtsDevWebhookSecret?: string };

/**
 * Секрет подписи webhook. Задан PAYMENT_WEBHOOK_SECRET — он; иначе (только вне production) случайный на процесс,
 * не печатается и не записывается. Значение нигде не логируется и не отдаётся в ответах.
 */
export function resolveWebhookSecret(env: Env = process.env): string {
  const configured = env.PAYMENT_WEBHOOK_SECRET?.trim();
  if (configured) return configured;
  return (g.__rtsDevWebhookSecret ??= randomBytes(32).toString('hex'));
}

/** Порт для случая «провайдер не выбран»: онлайн-оплата недоступна, webhook не принимается. */
export function createUnconfiguredPayment(): PaymentPort {
  const status: PortStatus = {
    connected: false,
    mode: 'stub',
    note: 'Платёжный провайдер не выбран: онлайн-оплата недоступна. Тестовый провайдер в production выключен.',
  };
  return {
    name: 'none',
    status: () => status,
    async createPayment() {
      throw new PaymentUnavailableError('Онлайн-оплата не подключена');
    },
    verifyWebhook: () => null,
    async refund() {
      throw new ConflictError('Возврат через платёжную систему недоступен: провайдер не выбран');
    },
  };
}

/**
 * Выбор реализации по env: PAYMENT_PROVIDER пусто/«test» и не production → тестовый провайдер;
 * иначе (production, либо неизвестный провайдер) → «не подключён». Настоящие провайдеры добавляются здесь.
 */
export function getPaymentPort(opts: { production?: boolean; env?: Env } = {}): PaymentPort {
  const env = opts.env ?? process.env;
  const production = opts.production ?? isProductionEnv(env);
  const provider = (env.PAYMENT_PROVIDER ?? '').trim().toLowerCase();
  if (!production && (provider === '' || provider === 'test')) {
    return createTestPaymentProvider({ secret: resolveWebhookSecret(env), production: false });
  }
  return createUnconfiguredPayment();
}
