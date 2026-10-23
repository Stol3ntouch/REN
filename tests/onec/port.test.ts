import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileOnecPort } from '@/integrations/onec/file-stub';
import type { OrderExport } from '@/integrations/onec/types';
import { tmpData, writeInbox } from './helpers';

const order = (over: Partial<OrderExport> = {}): OrderExport => ({
  externalId: 'RTS-000007',
  number: 'RTS-000007',
  createdAt: Date.UTC(2026, 9, 22, 12),
  contact: { name: 'Иван', email: 'ivan@example.test', phone: '+7 900 111-22-33', address: null, comment: null },
  delivery: { name: 'Самовывоз', kopecks: 0 },
  payment: { name: 'При получении' },
  items: [{ sku: 'GX-1', name: 'Генератор', qty: 1, unitKopecks: 100_000, lineKopecks: 100_000 }],
  subtotalKopecks: 100_000,
  discountKopecks: 0,
  totalKopecks: 100_000,
  ...over,
});

describe('OneCPort: файловая заглушка', () => {
  it('status: не подключено — заглушка', () => {
    const port = createFileOnecPort({ dataDir: tmpData() });
    expect(port.status()).toMatchObject({ connected: false, mode: 'stub' });
  });

  it('pushOrder дважды для одного заказа → один файл, второй вызов created=false', async () => {
    const dir = tmpData();
    const port = createFileOnecPort({ dataDir: dir });
    const a = await port.pushOrder(order());
    const b = await port.pushOrder(order());
    expect(a).toMatchObject({ externalId: 'RTS-000007', created: true });
    expect(b).toMatchObject({ externalId: 'RTS-000007', created: false });
    expect(readdirSync(join(dir, 'onec-outbox'))).toEqual(['RTS-000007.json']);
  });

  it('повторный push с другим содержимым не затирает файл молча: conflict=true, файл прежний', async () => {
    const dir = tmpData();
    const port = createFileOnecPort({ dataDir: dir });
    await port.pushOrder(order());
    const before = readFileSync(join(dir, 'onec-outbox', 'RTS-000007.json'), 'utf8');
    const res = await port.pushOrder(order({ totalKopecks: 5 }));
    expect(res).toMatchObject({ created: false, conflict: true });
    expect(readFileSync(join(dir, 'onec-outbox', 'RTS-000007.json'), 'utf8')).toBe(before);
  });

  it('номер заказа с путём не превращается в имя файла за пределами outbox', async () => {
    const dir = tmpData();
    const port = createFileOnecPort({ dataDir: dir });
    await expect(port.pushOrder(order({ externalId: '../evil', number: '../evil' }))).rejects.toThrow();
    expect(existsSync(join(dir, 'evil.json'))).toBe(false);
  });

  it('pullCatalog без файла → пустой пакет; с файлом — берёт самый свежий YML', async () => {
    const dir = tmpData();
    const port = createFileOnecPort({ dataDir: dir });
    expect(await port.pullCatalog()).toEqual({ fileName: null, xml: null });
    writeInbox(dir, 'catalog.yml', '<yml_catalog/>');
    expect(await port.pullCatalog()).toEqual({ fileName: 'catalog.yml', xml: '<yml_catalog/>' });
  });

  it('pullOrderStatuses: читает statuses.json, отбрасывает записи не новее since; битый файл → ошибка', async () => {
    const dir = tmpData();
    const port = createFileOnecPort({ dataDir: dir });
    expect(await port.pullOrderStatuses(new Date(0))).toEqual([]);
    writeInbox(
      dir,
      'statuses.json',
      JSON.stringify([
        { orderNumber: 'RTS-000001', status: 'shipped', updatedAt: '2026-10-22T10:00:00Z' },
        { orderNumber: 'RTS-000002', status: 'delivered', updatedAt: '2026-10-20T10:00:00Z' },
      ]),
    );
    const list = await port.pullOrderStatuses(new Date('2026-10-21T00:00:00Z'));
    expect(list).toEqual([{ orderNumber: 'RTS-000001', status: 'shipped', updatedAt: Date.parse('2026-10-22T10:00:00Z') }]);
    writeFileSync(join(dir, 'onec-inbox', 'statuses.json'), '{not json');
    await expect(port.pullOrderStatuses(new Date(0))).rejects.toThrow();
  });
});
