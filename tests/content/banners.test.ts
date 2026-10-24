import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createContentSaveHandler } from '@/domain/content/save-handler';
import { getHomeData } from '@/domain/content/home';
import { contentOps } from '@/domain/content/ops';
import { getCategoryBanners, listBanners } from '@/domain/content/queries';
import { loadShellContext } from '@/domain/content/shell';
import { createStaff, loginStaff } from '@/domain/admin/staff';
import { ADMIN_SESSION_COOKIE } from '@/domain/admin/staff-session';
import { openDatabase } from '@/server/db/connection';
import { runMigrations } from '@/server/db/migrate';
import { auditRepo } from '@/server/db/repositories/audit';
import { bannersRepo } from '@/server/db/repositories/banners';
import { createTestDb } from '@/server/db/testing';
import { ForbiddenError, ValidationError } from '@/server/http/errors';
import { fakeCookies } from '../auth/helpers';
import { ADMIN, MANAGER, T0, pngBytes, withUploadsDir } from './helpers';

const uploads = withUploadsDir();
const DAY = 86_400_000;
const mk = (db: ReturnType<typeof createTestDb>, extra: Record<string, unknown> = {}, now = T0) =>
  contentOps.banners.save(ADMIN, null, { title: 'Баннер', heading: 'Заголовок', position: 'home_hero', status: 'active', ...extra } as never, { db, now, uploadsDir: uploads.dir() });

describe('миграция слайдов в баннеры', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rts-mig-banners-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('слайды главной переезжают в баннеры home_hero без потерь: тексты, ссылка, кнопка, фото, alt, порядок, показ', () => {
    for (const f of readdirSync(join(process.cwd(), 'migrations'))) if (/^\d{4}_/.test(f) && Number(f.slice(0, 4)) < 1350) copyFileSync(join(process.cwd(), 'migrations', f), join(tmp, f));
    const db = openDatabase(':memory:');
    runMigrations(db, { dir: tmp });
    const ins = db.prepare('INSERT INTO slides (title, subtitle, link_url, link_label, image_path, image_variants, image_alt, active, sort, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    ins.run('Весна', 'Подзаголовок', '/catalog', 'В каталог', 'a.webp', '[{"key":"large","path":"a.webp","width":1,"height":1}]', 'Альт', 1, 2, 111);
    ins.run('Скрытый', null, null, null, null, null, null, 0, 1, 222);

    const res = runMigrations(db);
    expect(res.applied).toContain('1351_banners');
    const rows = bannersRepo.list(db);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.title)).toEqual(['Скрытый', 'Весна']); // порядок sort сохранён
    expect(rows[1]).toMatchObject({
      title: 'Весна', heading: 'Весна', subheading: 'Подзаголовок', url: '/catalog', buttonText: 'В каталог',
      imagePath: 'a.webp', alt: 'Альт', position: 'home_hero', status: 'active', sort: 2,
    });
    expect(rows[0]).toMatchObject({ status: 'inactive', position: 'home_hero' });
    expect((db.prepare('SELECT COUNT(*) AS n FROM slides').get() as { n: number }).n).toBe(2); // история остаётся
  });
});

describe('баннеры: правила', () => {
  it('на главной не больше трёх активных; отключённые лимит не занимают; включить четвёртый нельзя', async () => {
    const db = createTestDb();
    const ids: number[] = [];
    for (let i = 1; i <= 3; i++) ids.push((await mk(db, { title: `B${i}`, sort: i })).id);
    await expect(mk(db, { title: 'B4' })).rejects.toBeInstanceOf(ValidationError);
    expect(bannersRepo.count(db)).toBe(3);
    const off = (await mk(db, { title: 'Отключён', status: 'inactive' })).id;
    await expect(contentOps.visibility.set(ADMIN, 'banners', off, true, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    await contentOps.visibility.set(ADMIN, 'banners', ids[0]!, false, { db, now: T0 });
    await expect(contentOps.visibility.set(ADMIN, 'banners', off, true, { db, now: T0 })).resolves.toEqual({ changed: true });
    // другие позиции лимитом не затронуты
    await expect(mk(db, { title: 'Категория', position: 'category' })).resolves.toBeDefined();
  });

  it('ссылка — только путь на сайте или http(s); javascript:, data: и //хост отклоняются', async () => {
    const db = createTestDb();
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.test', 'ftp://x.test/a']) await expect(mk(db, { url: bad }), bad).rejects.toBeInstanceOf(ValidationError);
    await expect(mk(db, { url: '/catalog' })).resolves.toBeDefined();
    await expect(mk(db, { url: 'https://example.test/a', position: 'category' })).resolves.toBeDefined();
  });

  it('активность по датам и статусу: до начала и после конца баннера не видно', async () => {
    const db = createTestDb();
    await mk(db, { title: 'Скоро', startsAt: T0 + DAY });
    await mk(db, { title: 'Прошёл', endsAt: T0 - DAY, position: 'home_middle' });
    await mk(db, { title: 'Идёт', startsAt: T0 - DAY, endsAt: T0 + DAY, position: 'home_middle' });
    await mk(db, { title: 'Выключен', status: 'inactive', position: 'home_middle' });
    expect(listBanners('home_hero', { db, now: T0 })).toHaveLength(0);
    expect(listBanners('home_hero', { db, now: T0 + DAY }).map((b) => b.title)).toEqual(['Скоро']);
    expect(listBanners('home_middle', { db, now: T0 }).map((b) => b.title)).toEqual(['Идёт']);
    await expect(mk(db, { startsAt: T0 + DAY, endsAt: T0 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('изображения: JPG/PNG/WebP принимаются через хранилище, не-изображение отклоняется; есть отдельная картинка для телефона', async () => {
    const db = createTestDb();
    await expect(mk(db, { image: { bytes: new TextEncoder().encode('<?php evil ?>') } })).rejects.toBeInstanceOf(ValidationError);
    expect(bannersRepo.count(db)).toBe(0);
    const { id } = await mk(db, { alt: 'Газонокосилка', image: { bytes: await pngBytes(1600, 500) }, mobileImage: { bytes: await pngBytes(600, 600) } });
    const [view] = listBanners('home_hero', { db, now: T0 });
    expect(view?.id).toBe(id);
    expect(view?.image?.src).toMatch(/^\/api\/catalog\/media\/[a-f0-9]{32}-\d+\.webp$/);
    expect(view?.mobileImage?.src).toMatch(/^\/api\/catalog\/media\/[a-f0-9]{32}-\d+\.webp$/);
    expect(view?.image?.alt).toBe('Газонокосилка');
  });

  it('главная берёт баннеры home_hero вместо слайдера (не больше трёх), тексты админа выводятся как введены', async () => {
    const db = createTestDb();
    await mk(db, { title: 'Для списка', heading: '<b>Скидки</b> & акции' });
    const data = await getHomeData({ db, now: new Date(T0) });
    expect(data.slides.map((s) => s.title)).toEqual(['<b>Скидки</b> & акции']);
  });

  it('полоса над шапкой: текст берётся из заголовка баннера top_strip; без заголовка баннер не сохраняется', async () => {
    const db = createTestDb();
    await expect(mk(db, { position: 'top_strip', heading: '' })).rejects.toBeInstanceOf(ValidationError);
    await mk(db, { position: 'top_strip', heading: 'Склад на инвентаризации', url: '/contacts' });
    expect(loadShellContext({ db, now: T0 }).topStrip).toEqual({ text: 'Склад на инвентаризации', href: '/contacts' });
    expect(loadShellContext({ db: createTestDb(), now: T0 }).topStrip).toBeUndefined();
  });
});

describe('баннеры категорий: привязка и выбор', () => {
  function tree(db: ReturnType<typeof createTestDb>) {
    const ins = db.prepare("INSERT INTO categories (external_id, name, slug, parent_id) VALUES (?, ?, ?, ?)");
    const root = Number(ins.run('r', 'Корень', 'koren', null).lastInsertRowid);
    const child = Number(ins.run('c', 'Дочерняя', 'dochernyaya', root).lastInsertRowid);
    const other = Number(ins.run('o', 'Другая', 'drugaya', null).lastInsertRowid);
    return { root, child, other };
  }

  it('баннер показывается на привязанной категории и в подкатегориях; у своей привязки приоритет над унаследованной; отключённая привязка не действует', async () => {
    const db = createTestDb();
    const { root, child, other } = tree(db);
    const wide = (await mk(db, { title: 'Раздел', position: 'category', categoryIds: [root] })).id;
    expect(getCategoryBanners(root, { db, now: T0 }).map((b) => b.id)).toEqual([wide]);
    expect(getCategoryBanners(child, { db, now: T0 }).map((b) => b.id)).toEqual([wide]); // наследуется
    expect(getCategoryBanners(other, { db, now: T0 })).toEqual([]);

    const own = (await mk(db, { title: 'Своя', position: 'category', categoryIds: [child] })).id;
    expect(getCategoryBanners(child, { db, now: T0 }).map((b) => b.id)).toEqual([own]);

    await contentOps.banners.save(ADMIN, wide, { title: 'Раздел', position: 'category', categoryLinks: [{ categoryId: root, enabled: false }] }, { db, now: T0 });
    expect(getCategoryBanners(root, { db, now: T0 })).toEqual([]);
    // баннер другой позиции с привязкой в категории не попадает
    await mk(db, { title: 'Не категория', position: 'home_middle', categoryIds: [other] });
    expect(getCategoryBanners(other, { db, now: T0 })).toEqual([]);
  });

  it('несуществующая категория отклоняется; привязки копируются при дублировании; сортировка привязок сохраняется', async () => {
    const db = createTestDb();
    const { root, other } = tree(db);
    await expect(mk(db, { position: 'category', categoryIds: [99_999] })).rejects.toBeInstanceOf(ValidationError);
    const { id } = await mk(db, { position: 'category', categoryIds: [other, root] });
    expect(bannersRepo.listCategories(db, id).map((l) => l.categoryId)).toEqual([other, root]);
    const copy = (await contentOps.banners.duplicate(ADMIN, id, { db, now: T0 })).id;
    expect(bannersRepo.get(db, copy)).toMatchObject({ status: 'inactive', title: 'Баннер (копия)' });
    expect(bannersRepo.listCategories(db, copy).map((l) => l.categoryId)).toEqual([other, root]);
  });
});

describe('баннеры: права, аудит и обработчик формы', () => {
  it('менеджер — 403; создание, правка, удаление пишутся в аудит', async () => {
    const db = createTestDb();
    await expect(contentOps.banners.save(MANAGER, null, { title: 'x' }, { db })).rejects.toBeInstanceOf(ForbiddenError);
    const { id } = await mk(db);
    await contentOps.banners.save(ADMIN, id, { title: 'Новое', heading: 'Заголовок' }, { db, now: T0 });
    await contentOps.banners.remove(ADMIN, id, { db, now: T0 });
    expect(auditRepo.list(db, { entity: 'content_banners' }).map((a) => a.action).sort()).toEqual(['content.banners.create', 'content.banners.delete', 'content.banners.update']);
  });

  it('форма (multipart) создаёт баннер с привязкой к категории; 303 с ok; менеджер получает 403', async () => {
    const db = createTestDb();
    await createStaff({ email: 'boss@shop.test', password: 'admin-password-1', role: 'admin' }, { db, now: T0 });
    await createStaff({ email: 'mgr@shop.test', password: 'manager-password-1', role: 'manager' }, { db, now: T0 });
    const tok = async (email: string, password: string) => {
      const c = fakeCookies();
      await loginStaff({ email, password }, { db, cookies: c, ip: '1.1.1.1', now: T0 });
      return c.jar.get(ADMIN_SESSION_COOKIE)!;
    };
    const cat = Number(db.prepare("INSERT INTO categories (external_id, name, slug) VALUES ('k', 'Кат', 'kat')").run().lastInsertRowid);
    const handler = createContentSaveHandler({ db, now: T0, uploadsDir: uploads.dir() });
    const post = async (token: string) => {
      const form = new FormData();
      form.set('title', 'Из формы');
      form.set('position', 'category');
      form.set('status', 'active');
      form.set('heading', 'Сезон');
      form.set('startsAt', '2026-10-22T10:00');
      form.set('categoryIds__present', '1');
      form.append('categoryIds', String(cat));
      return handler(new Request('http://shop.test/admin/content/save/banners', { method: 'POST', headers: { host: 'shop.test', origin: 'http://shop.test', cookie: `${ADMIN_SESSION_COOKIE}=${token}` }, body: form }), { params: Promise.resolve({ entity: 'banners' }) });
    };
    expect((await post(await tok('mgr@shop.test', 'manager-password-1'))).status).toBe(403);
    expect(bannersRepo.count(db)).toBe(0);
    const res = await post(await tok('boss@shop.test', 'admin-password-1'));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/^\/admin\/content\/banners\?ok=1&edit=\d+$/);
    const row = bannersRepo.list(db)[0]!;
    expect(row).toMatchObject({ title: 'Из формы', position: 'category', startsAt: Date.parse('2026-10-22T10:00:00+03:00') });
    expect(bannersRepo.listCategories(db, row.id).map((l) => l.categoryId)).toEqual([cat]);
  });
});
