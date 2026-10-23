import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import { createFileOnecPort } from '@/integrations/onec/file-stub';
import { runPullCatalog, runPullStatuses, runPushOrders } from '@/integrations/onec/service';
import { integrationRunsRepo } from '@/server/db/repositories/integration-runs';
import { ordersRepo } from '@/server/db/repositories/orders';
import { productsRepo } from '@/server/db/repositories/products';
import { ymlXml } from '../importing/helpers';
import { createTestDb, orderWithItem, tmpData, writeInbox } from './helpers';

const NOW = Date.UTC(2026, 9, 22, 15);

function setup() {
  const db = createTestDb();
  const dir = tmpData();
  const port = createFileOnecPort({ dataDir: dir });
  const ctx = { db, port, now: NOW, actor: { staffId: 5 } };
  return { db, dir, port, ctx };
}

describe('выгрузка заказов в 1С', () => {
  it('повторный запуск не создаёт второй файл; запуск записан в integration_run с количеством', async () => {
    const { db, dir, ctx } = setup();
    const o = orderWithItem(db, 'processing');
    const first = await runPushOrders(ctx, { orderNumber: o.number });
    const second = await runPushOrders(ctx, { orderNumber: o.number });
    expect(first).toMatchObject({ status: 'ok', counts: { exported: 1, duplicates: 0 } });
    expect(second).toMatchObject({ status: 'ok', counts: { exported: 0, duplicates: 1 } });
    expect(readdirSync(join(dir, 'onec-outbox'))).toEqual([`${o.number}.json`]);
    const runs = integrationRunsRepo.list(db, { kind: 'onec.push_order' });
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ actor: 'staff:5' });
    expect(audit.list({ entity: 'integration_run' }, { db }).map((a) => a.action)).toContain('onec.push_order');
  });

  it('без номера отправляет только готовые к выгрузке: неоплаченный онлайн и отменённый остаются', async () => {
    const { db, ctx } = setup();
    const a = orderWithItem(db, 'processing');
    orderWithItem(db, 'cancelled');
    orderWithItem(db, 'awaiting_payment');
    const res = await runPushOrders(ctx, {});
    expect(res.counts.exported).toBe(1);
    expect(db.prepare('SELECT order_number FROM onec_exports').all()).toEqual([{ order_number: a.number }]);
  });

  it('заказ изменился после выгрузки (файл другой) → запуск с ошибкой, файл не перезаписан', async () => {
    const { db, dir, ctx } = setup();
    const o = orderWithItem(db, 'processing');
    await runPushOrders(ctx, { orderNumber: o.number });
    const file = join(dir, 'onec-outbox', `${o.number}.json`);
    writeFileSync(file, '{"tampered":true}');
    const res = await runPushOrders(ctx, { orderNumber: o.number });
    expect(res.status).toBe('error');
    expect(res.errors[0]).toContain(o.number);
    expect(existsSync(file)).toBe(true);
  });

  it('неизвестный номер заказа → ошибка запуска, исключение не летит наружу', async () => {
    const { ctx } = setup();
    const res = await runPushOrders(ctx, { orderNumber: 'RTS-999999' });
    expect(res.status).toBe('error');
  });
});

describe('статусы из 1С', () => {
  const status = (n: string, s: string, at: string) => ({ orderNumber: n, status: s, updatedAt: at });

  it('применяет допустимые, не трогает недопустимые и более свежие локальные изменения, повтор безопасен', async () => {
    const { db, dir, ctx } = setup();
    const ok = orderWithItem(db, 'processing', { now: Date.UTC(2026, 9, 20) });
    const fresh = orderWithItem(db, 'processing', { now: Date.UTC(2026, 9, 22, 14) }); // менялся локально позже записи 1С
    const bad = orderWithItem(db, 'new', { now: Date.UTC(2026, 9, 20) }); // new → delivered недопустимо
    const paid = orderWithItem(db, 'processing', { now: Date.UTC(2026, 9, 20) });
    writeInbox(
      dir,
      'statuses.json',
      JSON.stringify([
        status(ok.number, 'shipped', '2026-10-22T10:00:00Z'),
        status(fresh.number, 'shipped', '2026-10-22T10:00:00Z'),
        status(bad.number, 'delivered', '2026-10-22T10:00:00Z'),
        status(paid.number, 'paid', '2026-10-22T10:00:00Z'),
        status('RTS-424242', 'shipped', '2026-10-22T10:00:00Z'),
      ]),
    );
    const res = await runPullStatuses(ctx, { since: new Date(0) });
    expect(res.counts).toMatchObject({ applied: 1, skippedNewer: 1, rejected: 3 });
    expect(res.status).toBe('partial');
    expect(ordersRepo.findByNumber(db, ok.number)!.status).toBe('shipped');
    expect(ordersRepo.findByNumber(db, fresh.number)!.status).toBe('processing');
    expect(ordersRepo.findByNumber(db, bad.number)!.status).toBe('new');
    expect(ordersRepo.findByNumber(db, paid.number)!.status).toBe('processing');

    const again = await runPullStatuses(ctx, { since: new Date(0) });
    expect(again.counts.applied).toBe(0);
    expect(again.counts.unchanged).toBe(1);
    const ev = ordersRepo.listEvents(db, ok.id).filter((e) => e.kind === 'status');
    expect(ev.at(-1)).toMatchObject({ toStatus: 'shipped', actorType: 'system' });
  });

  it('битый файл статусов → запуск error, заказы не тронуты', async () => {
    const { db, dir, ctx } = setup();
    const o = orderWithItem(db, 'processing');
    writeInbox(dir, 'statuses.json', 'not json');
    const res = await runPullStatuses(ctx, { since: new Date(0) });
    expect(res.status).toBe('error');
    expect(ordersRepo.findByNumber(db, o.number)!.status).toBe('processing');
  });
});

describe('каталог из inbox 1С', () => {
  it('читает YML из inbox через общий импорт; повтор — 0 созданных, 0 дублей', async () => {
    const { db, dir, ctx } = setup();
    writeInbox(dir, 'catalog.yml', ymlXml({ offers: [{ id: '1' }, { id: '2' }] }));
    const first = await runPullCatalog(ctx);
    expect(first).toMatchObject({ status: 'ok', counts: { created: 2, updated: 0 } });
    const second = await runPullCatalog(ctx);
    expect(second).toMatchObject({ status: 'ok', counts: { created: 0, updated: 0, unchanged: 2 } });
    expect(productsRepo.count(db)).toBe(2);
  });

  it('нет файла → ok, files=0; не-XML → error с понятным текстом', async () => {
    const { dir, ctx } = setup();
    expect(await runPullCatalog(ctx)).toMatchObject({ status: 'ok', counts: { files: 0 } });
    writeInbox(dir, 'catalog.yml', 'это не xml');
    const bad = await runPullCatalog(ctx);
    expect(bad.status).toBe('error');
    expect(bad.errors[0]).toMatch(/XML/);
  });
});
