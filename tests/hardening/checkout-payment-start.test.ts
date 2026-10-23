import { describe, expect, it, vi } from 'vitest';
import { resolveOrderTarget } from '@/app/(shop)/checkout/payment-target';
import { orders } from '@/domain/ordering/orders';
import { setupDb, rawOrder, GUEST_A } from '../ordering/helpers';

const SECRET = 'x'.repeat(40);

function order(kind: 'guest' | 'user') {
  const db = setupDb();
  db.prepare("INSERT INTO users (id,email,password_hash,created_at) VALUES (1,'a@b.ru','x',1)").run();
  const raw = rawOrder(db, 'awaiting_payment', { owner: kind === 'guest' ? GUEST_A : { kind: 'user', userId: 1 } });
  return orders.getForStaff(raw.number, { db })!;
}

describe('заказ не теряется при сбое старта оплаты', () => {
  it('стартер упал: редирект на страницу заказа с placed=1 и пометкой «оплатить позже»', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const o = order('user');
    const target = await resolveOrderTarget(o, async () => {
      throw new Error('provider exploded: secret-key-123');
    });
    expect(target).toBe(`/order/${o.number}?placed=1&payment=later`);
    // в лог — только тип ошибки, без текста и данных
    expect(JSON.stringify(err.mock.calls)).not.toContain('secret-key-123');
    err.mockRestore();
  });

  it('гость: ссылка на заказ сохраняет подписанный токен', async () => {
    vi.stubEnv('SESSION_SECRET', SECRET);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const o = order('guest');
    const target = await resolveOrderTarget(o, async () => {
      throw new Error('boom');
    });
    expect(target.startsWith(`/order/${o.number}?t=`)).toBe(true);
    expect(target.endsWith('&placed=1&payment=later')).toBe(true);
    err.mockRestore();
    vi.unstubAllEnvs();
  });

  it('оплата стартовала: редирект на провайдера; нет оплаты (нал) — на заказ без пометки', async () => {
    const o = order('user');
    expect(await resolveOrderTarget(o, async () => ({ redirectUrl: '/pay/test/tp_1?t=abc' }))).toBe('/pay/test/tp_1?t=abc');
    expect(await resolveOrderTarget(o, async () => null)).toBe(`/order/${o.number}?placed=1`);
  });
});
