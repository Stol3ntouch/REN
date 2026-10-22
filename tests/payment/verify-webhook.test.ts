import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTestPaymentProvider } from '@/integrations/payment/test-provider';
import { SIGNATURE_HEADER } from '@/integrations/payment/types';
import { newPort, SECRET, signedWebhook } from './helpers';

const BASE = { paymentId: 'tp_abc', orderNumber: 'RTS-000001', amountKopecks: 100_000 };

describe('verifyWebhook (тестовый провайдер)', () => {
  it('верная подпись → событие с полями из тела', () => {
    const { body, headers } = signedWebhook(BASE);
    expect(newPort().verifyWebhook(body, headers)).toEqual({
      eventId: 'evt_1',
      type: 'payment.succeeded',
      paymentId: 'tp_abc',
      orderNumber: 'RTS-000001',
      amountKopecks: 100_000,
      currency: 'RUB',
      createdAt: expect.any(Number),
    });
  });

  it('подпись соответствует формату sha256=<hex HMAC-SHA256 по сырому телу> (считаем независимо)', () => {
    const { body, headers } = signedWebhook(BASE);
    const expected = 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
    expect(headers.get(SIGNATURE_HEADER)).toBe(expected);
  });

  it('неверная подпись (чужой секрет) → null', () => {
    const { body, headers } = signedWebhook(BASE, {}, 'другой-секрет-другой-секрет-другой-секрет');
    expect(newPort().verifyWebhook(body, headers)).toBeNull();
  });

  it('тело изменено после подписи (подменили сумму) → null', () => {
    const { body, headers } = signedWebhook(BASE);
    const tampered = body.replace('100000', '1');
    expect(tampered).not.toBe(body);
    expect(newPort().verifyWebhook(tampered, headers)).toBeNull();
  });

  it('нет заголовка подписи или он мусорный → null', () => {
    const { body } = signedWebhook(BASE);
    expect(newPort().verifyWebhook(body, new Headers())).toBeNull();
    expect(newPort().verifyWebhook(body, new Headers({ [SIGNATURE_HEADER]: 'sha256=zz' }))).toBeNull();
    expect(newPort().verifyWebhook(body, new Headers({ [SIGNATURE_HEADER]: '' }))).toBeNull();
  });

  it('валюта не RUB (даже с верной подписью) → null', () => {
    const { body, headers } = signedWebhook(BASE, { currency: 'USD' });
    expect(newPort().verifyWebhook(body, headers)).toBeNull();
  });

  it('нет event id, нечисловая или отрицательная сумма, неизвестный тип → null', () => {
    const port = newPort();
    for (const o of [{ eventId: '' }, { amountKopecks: -5 }, { amountKopecks: 10.5 }, { type: 'payment.refunded' }]) {
      const { body, headers } = signedWebhook(BASE, o);
      expect(port.verifyWebhook(body, headers), JSON.stringify(o)).toBeNull();
    }
    const body = '{не json';
    const headers = signedWebhook(BASE).headers;
    expect(port.verifyWebhook(body, headers)).toBeNull();
  });
});

describe('тестовый провайдер: ограничения', () => {
  it('в production тестовый провайдер создать нельзя', () => {
    expect(() => createTestPaymentProvider({ secret: SECRET, production: true })).toThrow();
  });
  it('без секрета создать нельзя', () => {
    expect(() => createTestPaymentProvider({ secret: '' })).toThrow();
  });
  it('статус — заглушка, не боевой режим', () => {
    expect(newPort().status()).toMatchObject({ connected: false, mode: 'stub' });
  });
});
