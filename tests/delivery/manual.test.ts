import { describe, expect, it } from 'vitest';
import { integrationsStatus } from '@/integrations';
import { createManualDelivery } from '@/integrations/delivery/manual';
import { setupDb } from '../ordering/helpers';

describe('DeliveryPort: ручная реализация', () => {
  it('listMethods отдаёт включённые способы из delivery_methods; у «по согласованию» цены нет', async () => {
    const db = setupDb();
    const port = createManualDelivery(() => db);
    const methods = await port.listMethods();
    expect(methods.map((m) => m.code)).toEqual(['pickup', 'manual']);
    expect(methods.find((m) => m.code === 'manual')!.priceKopecks).toBeNull();
    db.prepare("UPDATE delivery_methods SET enabled = 0 WHERE code = 'pickup'").run();
    expect((await port.listMethods()).map((m) => m.code)).toEqual(['manual']);
  });

  it('quote: стоимость не выдумывается — null и manual=true', async () => {
    const db = setupDb();
    const port = createManualDelivery(() => db);
    expect(await port.quote({ subtotalKopecks: 500_000 }, { text: 'г. Тест, ул. Тестовая, 1' })).toEqual({ priceKopecks: null, manual: true });
  });

  it('quote самовывоза: бесплатно из таблицы способов, не из головы', async () => {
    const db = setupDb();
    const port = createManualDelivery(() => db);
    expect(await port.quote({ subtotalKopecks: 1 }, null, { methodCode: 'pickup' })).toEqual({ priceKopecks: 0, manual: false });
  });

  it('status — заглушка, не подключено', () => {
    const s = createManualDelivery(() => setupDb()).status();
    expect(s).toMatchObject({ connected: false, mode: 'stub' });
    expect(s.note).toBeTruthy();
  });
});

describe('integrationsStatus', () => {
  it('оплата, доставка и 1С показаны как «не подключено — заглушка»', () => {
    const list = integrationsStatus({ production: false, env: {} });
    expect(list.map((e) => e.key)).toEqual(['payment', 'delivery', 'onec']);
    for (const e of list) expect(e.status).toMatchObject({ connected: false, mode: 'stub' });
  });
});
