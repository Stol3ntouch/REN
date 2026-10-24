import { describe, expect, it } from 'vitest';
import { createStaff, loginStaff } from '@/domain/admin/staff';
import { ADMIN_SESSION_COOKIE } from '@/domain/admin/staff-session';
import { contentOps } from '@/domain/content/ops';
import { createContentSaveHandler } from '@/domain/content/save-handler';
import { auditRepo } from '@/server/db/repositories/audit';
import { newsRepo } from '@/server/db/repositories/news';
import { createTestDb } from '@/server/db/testing';
import { ForbiddenError, UnauthorizedError } from '@/server/http/errors';
import { visibleNav } from '@/ui/admin/nav';
import { fakeCookies, T0 } from '../auth/helpers';
import { ADMIN, MANAGER } from './helpers';

async function setup() {
  const db = createTestDb();
  await createStaff({ email: 'boss@shop.test', password: 'admin-password-1', role: 'admin' }, { db, now: T0 });
  await createStaff({ email: 'mgr@shop.test', password: 'manager-password-1', role: 'manager' }, { db, now: T0 });
  const token = async (email: string, password: string) => {
    const c = fakeCookies();
    await loginStaff({ email, password }, { db, cookies: c, ip: '1.1.1.1', now: T0 });
    return c.jar.get(ADMIN_SESSION_COOKIE)!;
  };
  const handler = createContentSaveHandler({ db, now: T0 });
  const post = (entity: string, fields: Record<string, string>, tok?: string, origin = 'http://shop.test') => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return handler(
      new Request(`http://shop.test/admin/content/save/${entity}`, {
        method: 'POST',
        headers: { host: 'shop.test', origin, ...(tok ? { cookie: `${ADMIN_SESSION_COOKIE}=${tok}` } : {}) },
        body: form,
      }),
      { params: Promise.resolve({ entity }) },
    );
  };
  return { db, token, post };
}

describe('права на контент: только admin', () => {
  it('менеджер прямым запросом к обработчику сохранения получает 403 и ничего не пишется', async () => {
    const { db, token, post } = await setup();
    const res = await post('news', { title: 'Новость' }, await token('mgr@shop.test', 'manager-password-1'));
    expect(res.status).toBe(403);
    expect(newsRepo.list(db)).toHaveLength(0);
  });

  it('без сессии — 401; чужой Origin — 403 даже для администратора', async () => {
    const { token, post } = await setup();
    expect((await post('news', { title: 'x' })).status).toBe(401);
    expect((await post('news', { title: 'x' }, await token('boss@shop.test', 'admin-password-1'), 'http://evil.test')).status).toBe(403);
  });

  it('администратор сохраняет: 303 назад в раздел, запись создана, аудит записан', async () => {
    const { db, token, post } = await setup();
    const res = await post('news', { title: 'Открытие сезона', body: 'Текст' }, await token('boss@shop.test', 'admin-password-1'));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/admin\/content\/news\?ok=1/);
    expect(newsRepo.list(db).map((n) => n.title)).toEqual(['Открытие сезона']);
    expect(auditRepo.list(db, { entity: 'content_news' }).map((a) => a.action)).toEqual(['content.news.create']);
  });

  it('неизвестный раздел — 404', async () => {
    const { token, post } = await setup();
    expect((await post('nope', {}, await token('boss@shop.test', 'admin-password-1'))).status).toBe(404);
  });

  it('операции домена сами проверяют право content.write (не только обработчик)', async () => {
    const db = createTestDb();
    await expect(contentOps.news.save(MANAGER, null, { title: 'x' }, { db })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(contentOps.settings.save(MANAGER, { phone: '1' }, { db })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(contentOps.slides.remove(MANAGER, 1, { db })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(contentOps.news.save(null, null, { title: 'x' }, { db })).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(contentOps.news.save(ADMIN, null, { title: 'x' }, { db })).resolves.toBeDefined();
  });

  it('раздел «Страницы» (контент) виден в меню только администратору', () => {
    expect(visibleNav('admin').map((i) => i.label)).toContain('Страницы');
    expect(visibleNav('manager').map((i) => i.label)).not.toContain('Страницы');
  });
});
