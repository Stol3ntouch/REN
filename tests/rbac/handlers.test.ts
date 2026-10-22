import { describe, expect, it, vi } from 'vitest';
import { withStaffPermission, parseCookieHeader } from '@/domain/admin/guard';
import { ADMIN_SESSION_COOKIE } from '@/domain/admin/staff-session';
import { createStaff, loginStaff } from '@/domain/admin/staff';
import { createTestDb } from '@/server/db/testing';
import { fakeCookies, T0 } from '../auth/helpers';

async function setup() {
  const db = createTestDb();
  await createStaff({ email: 'boss@shop.test', password: 'admin-password-1', role: 'admin' }, { db, now: T0 });
  await createStaff({ email: 'mgr@shop.test', password: 'manager-password-1', role: 'manager' }, { db, now: T0 });
  const tokenFor = async (email: string, password: string) => {
    const c = fakeCookies();
    await loginStaff({ email, password }, { db, cookies: c, ip: '1.1.1.1', now: T0 });
    return c.jar.get(ADMIN_SESSION_COOKIE)!;
  };
  const call = (route: (req: Request) => Promise<Response>, o: { token?: string; method?: string; origin?: string } = {}) =>
    route(
      new Request('http://shop.test/api/admin/prices', {
        method: o.method ?? 'POST',
        headers: {
          host: 'shop.test',
          origin: o.origin ?? 'http://shop.test',
          ...(o.token ? { cookie: `theme=dark; ${ADMIN_SESSION_COOKIE}=${o.token}` } : {}),
        },
      }),
    );
  return { db, tokenFor, call };
}

describe('защищённый обработчик (withStaffPermission)', () => {
  it('менеджер прямым запросом к операции администратора получает 403 и обработчик не вызывается', async () => {
    const { db, tokenFor, call } = await setup();
    const inner = vi.fn(() => Response.json({ ok: true }));
    const route = withStaffPermission('catalog.write', inner, { db, now: T0 });

    const res = await call(route, { token: await tokenFor('mgr@shop.test', 'manager-password-1') });
    expect(res.status).toBe(403);
    expect(inner).not.toHaveBeenCalled();
  });

  it('без сессии → 401; с неверным токеном → 401', async () => {
    const { db, call } = await setup();
    const route = withStaffPermission('orders.read', () => Response.json({ ok: true }), { db, now: T0 });
    expect((await call(route, { method: 'GET' })).status).toBe(401);
    expect((await call(route, { method: 'GET', token: 'forged' })).status).toBe(401);
  });

  it('администратор и менеджер (с правом orders.write) проходят; обработчик получает сессию', async () => {
    const { db, tokenFor, call } = await setup();
    const inner = vi.fn((_req: Request, s: { role: string }) => Response.json({ role: s.role }));
    const route = withStaffPermission('orders.write', inner, { db, now: T0 });
    const a = await call(route, { token: await tokenFor('boss@shop.test', 'admin-password-1') });
    const m = await call(route, { token: await tokenFor('mgr@shop.test', 'manager-password-1') });
    expect(await a.json()).toEqual({ role: 'admin' });
    expect(await m.json()).toEqual({ role: 'manager' });
  });

  it('небезопасный метод с чужим Origin → 403 даже для администратора', async () => {
    const { db, tokenFor, call } = await setup();
    const inner = vi.fn(() => Response.json({ ok: true }));
    const route = withStaffPermission('catalog.write', inner, { db, now: T0 });
    const res = await call(route, { token: await tokenFor('boss@shop.test', 'admin-password-1'), origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(inner).not.toHaveBeenCalled();
  });

  it('ответ ошибки — JSON без деталей', async () => {
    const { db, tokenFor, call } = await setup();
    const route = withStaffPermission('staff.manage', () => Response.json({}), { db, now: T0 });
    const res = await call(route, { token: await tokenFor('mgr@shop.test', 'manager-password-1') });
    expect(await res.json()).toEqual({ error: { code: 'forbidden', message: expect.any(String) } });
  });
});

describe('parseCookieHeader', () => {
  it('читает значения, в том числе с «=» внутри; пустой заголовок — пусто', () => {
    const c = parseCookieHeader('a=1; b=x=y; c=%D0%B0');
    expect(c.get('a')?.value).toBe('1');
    expect(c.get('b')?.value).toBe('x=y');
    expect(c.get('c')?.value).toBe('а');
    expect(c.get('zzz')).toBeUndefined();
    expect(parseCookieHeader(null).get('a')).toBeUndefined();
  });
});
