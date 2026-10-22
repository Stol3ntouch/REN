import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { SIGNATURE_HEADER, type PaymentPort, type WebhookEvent } from './types';

export type TestProviderOptions = { secret: string; production?: boolean };

/** Значение заголовка подписи: `sha256=<hex HMAC-SHA256(secret, rawBody)>`. */
export function signWebhookBody(secret: string, rawBody: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/** Сравнение подписи за постоянное время; любая неправильная форма → false. */
export function isValidSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!header || !/^sha256=[0-9a-f]{64}$/.test(header)) return false;
  const expected = Buffer.from(signWebhookBody(secret, rawBody));
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const eventSchema = z.object({
  eventId: z.string().min(1).max(100),
  type: z.enum(['payment.succeeded', 'payment.failed']),
  paymentId: z.string().min(1).max(100),
  orderNumber: z.string().min(1).max(40),
  amountKopecks: z.number().int().nonnegative(),
  currency: z.literal('RUB'),
  createdAt: z.number().int(),
});

/**
 * Тестовый провайдер (только вне production): платёж создаётся локально, покупатель попадает на страницу
 * «ТЕСТОВАЯ ОПЛАТА». Деньги не списываются, карточные данные не запрашиваются.
 */
export function createTestPaymentProvider(opts: TestProviderOptions): PaymentPort {
  if (opts.production) throw new Error('Тестовый платёжный провайдер недоступен в production');
  if (!opts.secret) throw new Error('Для тестового провайдера нужен секрет подписи webhook');
  const secret = opts.secret;
  return {
    name: 'test',
    status: () => ({ connected: false, mode: 'stub', note: 'Тестовый провайдер: деньги не списываются. Боевая оплата не подключена.' }),
    async createPayment() {
      const paymentId = `tp_${randomBytes(12).toString('hex')}`;
      return { paymentId, redirectUrl: `/pay/test/${paymentId}` };
    },
    verifyWebhook(rawBody: string, headers: Headers): WebhookEvent | null {
      if (!isValidSignature(secret, rawBody, headers.get(SIGNATURE_HEADER))) return null;
      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        return null;
      }
      const parsed = eventSchema.safeParse(json);
      return parsed.success ? parsed.data : null;
    },
    async refund(_paymentId: string, amountKopecks: number) {
      // Тестовый возврат: у провайдера ничего не списывается и не возвращается.
      if (!Number.isInteger(amountKopecks) || amountKopecks <= 0) throw new Error('Некорректная сумма возврата');
    },
  };
}
