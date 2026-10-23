import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import { integrationsOps } from '@/app/admin/(panel)/_lib/integrations-ops';
import { createFileOnecPort } from '@/integrations/onec/file-stub';
import { integrationRunsRepo } from '@/server/db/repositories/integration-runs';
import { createTestDb } from '@/server/db/testing';
import { ConflictError, ForbiddenError, ValidationError } from '@/server/http/errors';
import { orderWithItem, tmpData, writeInbox } from '../onec/helpers';
import { ymlXml } from '../importing/helpers';
import { admin, manager, T0 } from './helpers';

function setup() {
  const db = createTestDb();
  const dir = tmpData();
  const port = createFileOnecPort({ dataDir: dir });
  return { db, dir, port, opts: { db, port, now: T0 } };
}

describe('интеграции: статусы без значений секретов', () => {
  const SECRETS = { PAYMENT_API_KEY: 'sk_live_TOPSECRET_123', PAYMENT_WEBHOOK_SECRET: 'whsec_TOPSECRET_456', MAIL_PASSWORD: 'p@ssw0rd-TOPSECRET', MAIL_HOST: 'smtp.private.example', ONEC_MODE: 'live-TOPSECRET' };

  it('имена переменных и «задан/не задан»; ни одно значение не попадает в ответ', () => {
    const { opts } = setup();
    const view = integrationsOps.overview(admin, { ...opts, env: SECRETS });
    const json = JSON.stringify(view);
    for (const v of Object.values(SECRETS)) expect(json).not.toContain(v);
    expect(json).not.toContain('TOPSECRET');
    expect(view.env.find((e) => e.name === 'PAYMENT_API_KEY')).toMatchObject({ set: true });
    expect(view.env.find((e) => e.name === 'MAIL_USER')).toMatchObject({ set: false });
    expect(view.env.every((e) => Object.keys(e).sort().join() === 'name,purpose,set')).toBe(true);
  });

  it('пустая и пробельная переменная считается не заданной', () => {
    const { opts } = setup();
    const view = integrationsOps.overview(admin, { ...opts, env: { MAIL_HOST: '', MAIL_USER: '   ' } });
    expect(view.env.find((e) => e.name === 'MAIL_HOST')?.set).toBe(false);
    expect(view.env.find((e) => e.name === 'MAIL_USER')?.set).toBe(false);
  });

  it('порты показаны как заглушки «не подключено»; 1С есть в списке', () => {
    const { opts } = setup();
    const view = integrationsOps.overview(admin, { ...opts, env: {} });
    expect(view.ports.map((p) => p.key)).toEqual(['payment', 'delivery', 'onec']);
    for (const p of view.ports) expect(p.status).toMatchObject({ connected: false, mode: 'stub' });
  });

  it('просмотр доступен менеджеру; запуск — нет', () => {
    const { opts } = setup();
    expect(() => integrationsOps.overview(manager, { ...opts, env: {} })).not.toThrow();
    return expect(integrationsOps.run(manager, 'pull_catalog', {}, opts)).rejects.toThrow(ForbiddenError);
  });

  it('ошибки платежей и webhook с нужным вниманием попадают в обзор', () => {
    const { db, opts } = setup();
    const o = orderWithItem(db, 'new');
    db.prepare("INSERT INTO payments (order_id, provider, status, amount_kopecks, external_id, error_code, error_message, created_at, updated_at) VALUES (?, 'test', 'error', 100, 'err_1', 'timeout', 'провайдер не ответил', 1, 1)").run(o.id);
    db.prepare("INSERT INTO webhook_events (provider, event_id, event_type, outcome, detail, received_at) VALUES ('test', 'e1', 'payment.succeeded', 'alert', 'оплата по отменённому заказу', 1)").run();
    const view = integrationsOps.overview(admin, { ...opts, env: {} });
    expect(view.paymentErrors).toHaveLength(1);
    expect(view.paymentErrors[0]).toMatchObject({ errorCode: 'timeout' });
    expect(view.webhookAttention).toHaveLength(1);
  });
});

describe('интеграции: запуск и безопасный повтор', () => {
  it('админ запускает выгрузку заказов; запуск виден в журнале; повтор не создаёт дублей', async () => {
    const { db, opts } = setup();
    orderWithItem(db, 'processing');
    const first = await integrationsOps.run(admin, 'push_orders', {}, opts);
    const second = await integrationsOps.run(admin, 'push_orders', {}, opts);
    expect(first.counts.exported).toBe(1);
    expect(second.counts).toMatchObject({ exported: 0, duplicates: 0 });
    expect(integrationsOps.overview(admin, { ...opts, env: {} }).runs.map((r) => r.kind)).toEqual(['onec.push_order', 'onec.push_order']);
    expect(integrationRunsRepo.list(db)[1]).toMatchObject({ actor: 'staff:1' });
  });

  it('ошибочный запуск виден оператору, «повторить» после исправления проходит и не дублирует', async () => {
    const { db, dir, opts } = setup();
    writeInbox(dir, 'catalog.yml', 'сломанный файл');
    const bad = await integrationsOps.run(admin, 'pull_catalog', {}, opts);
    expect(bad.status).toBe('error');
    expect(integrationRunsRepo.get(db, bad.runId)).toMatchObject({ status: 'error' });
    writeFileSync(join(dir, 'onec-inbox', 'catalog.yml'), ymlXml({ offers: [{ id: '1' }] }));
    const retry1 = await integrationsOps.retry(admin, bad.runId, opts);
    const retry2 = await integrationsOps.retry(admin, bad.runId, opts);
    expect(retry1).toMatchObject({ status: 'ok', counts: { created: 1 } });
    expect(retry2).toMatchObject({ status: 'ok', counts: { created: 0, unchanged: 1 } });
    expect(audit.list({ entity: 'integration_run' }, { db }).length).toBeGreaterThanOrEqual(3);
  });

  it('повтор платёжного запуска недоступен; неизвестное действие и кривой номер отвергаются', async () => {
    const { db, opts } = setup();
    const id = integrationRunsRepo.start(db, { kind: 'payment.webhook', actor: 'system', now: T0 });
    integrationRunsRepo.finish(db, id, { status: 'error', counts: {}, errors: ['x'], now: T0 });
    await expect(integrationsOps.retry(admin, id, opts)).rejects.toThrow(ConflictError);
    await expect(integrationsOps.run(admin, 'format_disk' as never, {}, opts)).rejects.toThrow(ValidationError);
    await expect(integrationsOps.run(admin, 'push_order', { orderNumber: '../x' }, opts)).rejects.toThrow(ValidationError);
  });
});
