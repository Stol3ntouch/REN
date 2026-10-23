import { describe, expect, it } from 'vitest';
import { createStaff, loginStaff } from '@/domain/admin/staff';
import { ADMIN_SESSION_COOKIE } from '@/domain/admin/staff-session';
import { analyticsOps } from '@/domain/analytics';
import { createAnalyticsExportHandler } from '@/app/admin/(panel)/_lib/analytics-handlers';
import { auditOps } from '@/app/admin/(panel)/_lib/audit-ops';
import { catalogOps } from '@/app/admin/(panel)/_lib/catalog-ops';
import { customersOps } from '@/app/admin/(panel)/_lib/customers-ops';
import { importOps } from '@/app/admin/(panel)/_lib/import-ops';
import { integrationsOps } from '@/app/admin/(panel)/_lib/integrations-ops';
import { settingsOps } from '@/app/admin/(panel)/_lib/settings-ops';
import { staffOps } from '@/app/admin/(panel)/_lib/staff-ops';
import { createTestDb } from '@/server/db/testing';
import { ForbiddenError, UnauthorizedError } from '@/server/http/errors';
import { fakeCookies } from '../auth/helpers';
import { ms, seedOctober } from '../analytics/helpers';
import { admin, manager, setManualEdit, T0 } from './helpers';

const RANGE = { from: ms('2026-10-01T00:00:00+03:00'), to: ms('2026-11-01T00:00:00+03:00') };

/** Каждая операция раздела: manager и аноним получают отказ, admin проходит (или доходит до своей бизнес-проверки). */
describe('права на каждую операцию раздела', () => {
  const db = createTestDb();
  setManualEdit(db, true);
  const o = { db, now: T0 };
  const ops: [string, (s: typeof admin | null) => unknown | Promise<unknown>, 'admin' | 'manager'][] = [
    // [название, вызов, минимальная роль]
    ['analytics.report', (s) => analyticsOps.report(s, RANGE, 'day', o), 'admin'],
    ['analytics.exportCsv', (s) => analyticsOps.exportCsv(s, 'series', RANGE, 'day', o), 'admin'],
    ['audit.list', (s) => auditOps.list(s, {}, o), 'admin'],
    ['settings.get', (s) => settingsOps.get(s, o), 'admin'],
    ['settings.setManualEdit', (s) => settingsOps.setManualEdit(s, true, o), 'admin'],
    ['settings.setRecipients', (s) => settingsOps.setRecipients(s, 'a@b.ru', o), 'admin'],
    ['staff.list', (s) => staffOps.list(s, o), 'admin'],
    ['staff.create', (s) => staffOps.create(s, { email: 'zz@shop.test', password: 'long-password-1', role: 'manager' }, o), 'admin'],
    ['staff.setRole', (s) => staffOps.setRole(s, 9999, 'manager', o), 'admin'],
    ['staff.setActive', (s) => staffOps.setActive(s, 9999, false, o), 'admin'],
    ['catalog.update', (s) => catalogOps.update(s, 9999, { published: true }, o), 'admin'],
    ['catalog.unlock', (s) => catalogOps.unlock(s, 9999, ['price'], o), 'admin'],
    ['catalog.list', (s) => catalogOps.list(s, {}, o), 'manager'],
    ['catalog.get', (s) => catalogOps.get(s, 1, o), 'manager'],
    ['customers.list', (s) => customersOps.list(s, {}, o), 'manager'],
    ['customers.get', (s) => customersOps.get(s, 1, o), 'manager'],
    ['import.preview', (s) => importOps.preview(s, { fileName: 'a.yml', content: Buffer.from('x') }, o), 'admin'],
    ['import.apply', (s) => importOps.apply(s, 1, o), 'admin'],
    ['import.history', (s) => importOps.history(s, o), 'manager'],
    ['integrations.overview', (s) => integrationsOps.overview(s, { ...o, env: {} }), 'manager'],
    ['integrations.run', (s) => integrationsOps.run(s, 'pull_statuses', {}, o), 'admin'],
    ['integrations.retry', (s) => integrationsOps.retry(s, 1, o), 'admin'],
  ];

  const settle = async (fn: () => unknown) => {
    try {
      await fn();
      return null;
    } catch (e) {
      return e;
    }
  };

  for (const [name, call, min] of ops) {
    it(`${name}: аноним → 401`, async () => {
      expect(await settle(() => call(null))).toBeInstanceOf(UnauthorizedError);
    });
    it(`${name}: manager ${min === 'admin' ? 'отвергается (403)' : 'допускается'}`, async () => {
      const err = await settle(() => call(manager));
      if (min === 'admin') expect(err).toBeInstanceOf(ForbiddenError);
      else expect(err).not.toBeInstanceOf(ForbiddenError);
    });
    it(`${name}: admin не получает отказ по правам`, async () => {
      const err = await settle(() => call(admin));
      expect(err).not.toBeInstanceOf(ForbiddenError);
      expect(err).not.toBeInstanceOf(UnauthorizedError);
    });
  }
});

describe('экспорт CSV по HTTP', () => {
  async function setup() {
    const db = createTestDb();
    seedOctober(db);
    await createStaff({ email: 'boss@shop.test', password: 'admin-password-1', role: 'admin' }, { db, now: T0 });
    await createStaff({ email: 'mgr@shop.test', password: 'manager-password-1', role: 'manager' }, { db, now: T0 });
    const tokenFor = async (email: string, password: string) => {
      const c = fakeCookies();
      await loginStaff({ email, password }, { db, cookies: c, ip: '1.1.1.1', now: T0 });
      return c.jar.get(ADMIN_SESSION_COOKIE)!;
    };
    const handler = createAnalyticsExportHandler({ db, now: T0 });
    const get = (query: string, token?: string) =>
      handler(new Request(`http://shop.test/admin/analytics/export?${query}`, { headers: { host: 'shop.test', ...(token ? { cookie: `${ADMIN_SESSION_COOKIE}=${token}` } : {}) } }));
    return { tokenFor, get };
  }

  it('аноним 401, менеджер 403, админ получает CSV с BOM и заголовками скачивания', async () => {
    const { tokenFor, get } = await setup();
    const q = 'kind=categories&from=2026-10-01&to=2026-10-31';
    expect((await get(q)).status).toBe(401);
    expect((await get(q, await tokenFor('mgr@shop.test', 'manager-password-1'))).status).toBe(403);
    const res = await get(q, await tokenFor('boss@shop.test', 'admin-password-1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="analytics-categories-2026-10-01_2026-10-31.csv"');
    const buf = Buffer.from(await res.arrayBuffer());
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(buf.toString('utf8')).toContain('Генераторы;3;3000,00');
  });

  it('неизвестный вид выгрузки → 400', async () => {
    const { tokenFor, get } = await setup();
    expect((await get('kind=../../etc', await tokenFor('boss@shop.test', 'admin-password-1'))).status).toBe(400);
  });
});
