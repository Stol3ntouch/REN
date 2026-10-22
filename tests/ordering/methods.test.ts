import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import seedOrdering from '../../scripts/seed/30-ordering';
import { ADMIN_NAV } from '@/ui/admin/nav';
import { methodsRepo } from '@/server/db/repositories/methods';
import { setupDb } from './helpers';

const originalEnv = process.env.NODE_ENV;
afterEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
});

describe('способы получения и оплаты после миграции', () => {
  it('самовывоз 0 ₽, доставка по согласованию без цены и с обязательным адресом, оплата при получении — всё включено', () => {
    const db = setupDb();
    const delivery = methodsRepo.listDelivery(db, { enabledOnly: true });
    expect(delivery.map((d) => [d.code, d.priceKopecks, d.requiresAddress])).toEqual([
      ['pickup', 0, false],
      ['manual', null, true],
    ]);
    expect(methodsRepo.listPayment(db, { enabledOnly: true }).map((p) => [p.code, p.kind])).toEqual([['cod', 'cash_on_delivery']]);
  });

  it('в чистой БД (то есть в production) метода «онлайн (ТЕСТ)» нет вообще', () => {
    const db = setupDb();
    expect(methodsRepo.findPaymentByCode(db, 'online_test')).toBeNull();
  });

  it('dev-сид заводит «онлайн (ТЕСТ)» выключенным и не дублирует; в production сид его не создаёт', () => {
    const dev = setupDb();
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    seedOrdering(dev);
    seedOrdering(dev);
    const rows = methodsRepo.listPayment(dev).filter((p) => p.code === 'online_test');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ enabled: false, testOnly: true, kind: 'online' });

    const prod = setupDb();
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    seedOrdering(prod);
    expect(methodsRepo.findPaymentByCode(prod, 'online_test')).toBeNull();
  });
});

describe('навигация админки', () => {
  it('«Заказы» и «Цены и акции» есть и ведут на существующие страницы', () => {
    for (const key of ['orders', 'pricing']) {
      const item = ADMIN_NAV.find((i) => i.key === key);
      expect(item, key).toBeDefined();
      expect(existsSync(join(process.cwd(), 'src', 'app', 'admin', '(panel)', ...item!.href.split('/').slice(2), 'page.tsx')), item!.href).toBe(true);
    }
  });
});
