import type { PortStatus } from '../types';

export type WebhookEventType = 'payment.succeeded' | 'payment.failed';

/** Проверенное по подписи событие провайдера. Сверка с заказом (сумма, валюта, номер) — в обработчике. */
export type WebhookEvent = {
  eventId: string;
  type: WebhookEventType;
  paymentId: string;
  orderNumber: string;
  amountKopecks: number;
  currency: 'RUB';
  createdAt: number;
};

export type CreatePaymentInput = { orderNumber: string; amountKopecks: number; returnUrl: string };

/** Данные карты порт не запрашивает и не хранит: покупатель вводит их только на стороне провайдера. */
export interface PaymentPort {
  /** Код провайдера в payments.provider. */
  readonly name: string;
  status(): PortStatus;
  createPayment(o: CreatePaymentInput): Promise<{ paymentId: string; redirectUrl: string }>;
  /** Подпись + форма события; неверное → null. Секрет в ответах и логах не появляется. */
  verifyWebhook(rawBody: string, headers: Headers): WebhookEvent | null;
  refund(paymentId: string, amountKopecks: number, opts?: { idempotencyKey?: string }): Promise<void>;
}

/** Заголовок подписи webhook: `x-rts-signature: sha256=<hex HMAC-SHA256(secret, rawBody)>`. */
export const SIGNATURE_HEADER = 'x-rts-signature';

export class PaymentTimeoutError extends Error {
  constructor() {
    super('Платёжный провайдер не ответил вовремя');
    this.name = 'PaymentTimeoutError';
  }
}
export class PaymentUnavailableError extends Error {
  constructor(message = 'Платёжный провайдер недоступен') {
    super(message);
    this.name = 'PaymentUnavailableError';
  }
}
