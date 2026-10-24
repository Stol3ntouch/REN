import { describe, expect, it } from 'vitest';
import { auditOps } from '@/app/admin/(panel)/_lib/audit-ops';
import { auditFilterFromParams } from '@/app/admin/(panel)/_lib/audit-params';
import { audit } from '@/domain/admin/audit';
import { runWithRequestInfo } from '@/domain/admin/audit-context';
import { withStaffPermission } from '@/domain/admin/guard';
import { createStaff, loginStaff, logoutStaff } from '@/domain/admin/staff';
import { ADMIN_SESSION_COOKIE, getStaffSession } from '@/domain/admin/staff-session';
import { createTestDb } from '@/server/db/testing';
import { ForbiddenError, UnauthorizedError } from '@/server/http/errors';
import { fakeCookies, T0 } from '../auth/helpers';

const DAY = 86_400_000;

async function setup() {
  const db = createTestDb();
  const o = { db, now: T0 };
  await createStaff({ email: 'boss', password: 'boss-password-123', role: 'admin' }, o);
  await createStaff({ email: 'mgr', password: 'manager-password-1', role: 'manager' }, o);
  const login = async (id: string, password: string, ip = '1.1.1.1') => {
    const c = fakeCookies();
    await loginStaff({ email: id, password }, { db, cookies: c, ip, now: T0 });
    return { c, session: getStaffSession(c, { db, now: T0 })! };
  };
  const boss = await login('boss', 'boss-password-123');
  const mgr = await login('mgr', 'manager-password-1');
  return { db, o, boss, mgr, login };
}

describe('журнал действий', () => {
  it('вход, неудачный вход и выход пишутся; пароль и сырой IP/User-Agent не попадают в записи', async () => {
    const { db, boss } = await setup();
    await expect(loginStaff({ email: 'boss', password: 'wrong-password-999' }, { db, cookies: fakeCookies(), ip: '8.8.8.8', now: T0 })).rejects.toBeInstanceOf(UnauthorizedError);
    runWithRequestInfo({ ip: '203.0.113.7', userAgent: 'Mozilla/5.0 TestAgent' }, () => logoutStaff(boss.c, { db, now: T0 }));
    const rows = audit.list({ entity: 'auth' }, { db }).reverse();
    expect(rows.map((r) => [r.action, r.result])).toEqual([
      ['auth.login', 'ok'],
      ['auth.login', 'ok'],
      ['auth.login_failed', 'denied'],
      ['auth.logout', 'ok'],
    ]);
    const out = rows[3]!;
    expect(out.ipHash).toMatch(/^[0-9a-f]{16}$/);
    expect(out.uaHash).toMatch(/^[0-9a-f]{16}$/);
    const dump = JSON.stringify(rows) + JSON.stringify(db.prepare('SELECT * FROM audit_log').all());
    expect(dump).not.toMatch(/203\.0\.113\.7|TestAgent|wrong-password-999|boss-password-123/);
    void ADMIN_SESSION_COOKIE;
  });

  it('фильтры: пользователь, период, тип действия (префикс), объект, id объекта, результат; пагинация с итогом', async () => {
    const { db, o, boss } = await setup();
    const put = (n: number, action: string, entity: string, entityId: string | number, actor: number, result: 'ok' | 'denied', at: number) =>
      audit.record({ actorId: actor, actorType: 'staff', action, entity, entityId, result }, { db, now: at });
    for (let i = 0; i < 7; i++) put(i, 'price.change', 'product', 100 + i, 1, 'ok', T0 + 10 * DAY + i);
    put(7, 'staff.block', 'staff', 5, 92, 'ok', T0 + 11 * DAY);
    put(8, 'access.denied', 'admin_route', '/x', 92, 'denied', T0 + 12 * DAY);

    const list = (f: Parameters<typeof auditOps.list>[1]) => auditOps.list(boss.session, f, { db });
    expect(list({ actorId: '92' }).rows.map((r) => r.action).sort()).toEqual(['access.denied', 'staff.block']);
    expect(list({ actionPrefix: 'staff.' }).total).toBe(3); // 2 создания в setup + блокировка
    expect(list({ actionPrefix: 'staff.bl' }).total).toBe(1);
    expect(list({ action: 'price.change', entityId: '103' }).rows).toHaveLength(1);
    expect(list({ entity: 'product' }).total).toBe(7);
    expect(list({ result: 'denied' }).rows[0]!.action).toBe('access.denied');
    expect(list({ result: 'bogus' }).total).toBe(list({}).total); // неизвестный результат игнорируется
    expect(list({ from: T0 + 11 * DAY, to: T0 + 12 * DAY }).rows.map((r) => r.action)).toEqual(['staff.block']);
    const p = list({ entity: 'product', pageSize: 3, page: 3 });
    expect([p.rows.length, p.total, p.hasNext]).toEqual([1, 7, false]);
    expect(o.now).toBe(T0);
  });

  it('период из адреса: даты «с» и «по» включают оба дня целиком по Москве', () => {
    const f = auditFilterFromParams({ from: '2026-10-10', to: '2026-10-11' });
    expect(f.from).toBe(Date.parse('2026-10-10T00:00:00+03:00'));
    expect(f.to).toBe(Date.parse('2026-10-12T00:00:00+03:00'));
    expect(auditFilterFromParams({ from: 'мусор', to: '2026-13-45' })).toMatchObject({ from: undefined, to: undefined });
  });

  it('читать и экспортировать может только audit.read: без сессии 401, менеджер 403', async () => {
    const { db, boss, mgr } = await setup();
    for (const fn of [(s: typeof boss.session | null) => auditOps.list(s, {}, { db }), (s: typeof boss.session | null) => auditOps.exportCsv(s, {}, { db })]) {
      expect(() => fn(null)).toThrow(UnauthorizedError);
      expect(() => fn(mgr.session)).toThrow(ForbiddenError);
      expect(() => fn(boss.session)).not.toThrow();
    }
  });

  it('экспорт CSV: отфильтрованное, формулы экранированы, сам экспорт в журнале', async () => {
    const { db, boss } = await setup();
    audit.record({ actorId: 1, actorType: 'staff', action: '=cmd', entity: 'x', entityId: 1 }, { db, now: T0 });
    const all = auditOps.exportCsv(boss.session, {}, { db });
    const only = auditOps.exportCsv(boss.session, { actionPrefix: '=cmd' }, { db });
    expect(only.rows).toBe(1);
    expect(only.csv).toContain("'=cmd");
    expect(all.rows).toBeGreaterThan(only.rows);
    expect(audit.list({ action: 'audit.export' }, { db }).length).toBe(2);
  });

  it('отказ по правам в обработчике пишется как denied; запись неизменяема на уровне БД', async () => {
    const { db, mgr, o } = await setup();
    const route = withStaffPermission('settings.write', () => Response.json({ ok: true }), o);
    const res = await route(new Request('http://shop.test/admin/api/x', { method: 'POST', headers: { host: 'shop.test', origin: 'http://shop.test', cookie: `${ADMIN_SESSION_COOKIE}=${mgr.c.jar.get(ADMIN_SESSION_COOKIE)}`, 'user-agent': 'UA-1' } }));
    expect(res.status).toBe(403);
    const denied = audit.list({ action: 'access.denied' }, { db });
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ result: 'denied', entity: 'admin_route', entityId: '/admin/api/x' });
    expect(denied[0]!.uaHash).toMatch(/^[0-9a-f]{16}$/);
    expect(() => db.prepare("UPDATE audit_log SET result = 'ok'").run()).toThrow();
    expect(() => db.prepare('DELETE FROM audit_log').run()).toThrow();
  });
});
