import { createStaff, loginStaff } from '@/domain/admin/staff';
import { ADMIN_SESSION_COOKIE } from '@/domain/admin/staff-session';
import type { Db } from '@/server/db/connection';
import { fakeCookies, T0 } from '../auth/helpers';

export { T0 };

/** Заводит администратора и менеджера и отдаёт заголовок Cookie для запросов к обработчикам от их имени. */
export async function staffCookies(db: Db): Promise<{ admin: string; manager: string; adminId: number; managerId: number }> {
  const boss = await createStaff({ email: 'boss@shop.test', password: 'admin-password-1', role: 'admin' }, { db, now: T0 });
  const mgr = await createStaff({ email: 'mgr@shop.test', password: 'manager-password-1', role: 'manager' }, { db, now: T0 });
  const cookieOf = async (email: string, password: string): Promise<string> => {
    const c = fakeCookies();
    await loginStaff({ email, password }, { db, cookies: c, ip: '1.1.1.1', now: T0 });
    return `${ADMIN_SESSION_COOKIE}=${c.jar.get(ADMIN_SESSION_COOKIE)!}`;
  };
  return {
    admin: await cookieOf('boss@shop.test', 'admin-password-1'),
    manager: await cookieOf('mgr@shop.test', 'manager-password-1'),
    adminId: boss.staffId,
    managerId: mgr.staffId,
  };
}

export const req = (url: string, o: { cookie?: string; method?: string; body?: unknown } = {}): Request =>
  new Request(url, {
    method: o.method ?? 'GET',
    headers: { host: 'shop.test', origin: 'http://shop.test', ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
  });
