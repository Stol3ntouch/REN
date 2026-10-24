import { describe, expect, it } from 'vitest';
import { createStaff } from '@/domain/admin/staff';
import { listAdminEntity } from '@/domain/content/admin-list';
import { contentOps } from '@/domain/content/ops';
import { previewOps } from '@/domain/content/ops-pages';
import { countPublishedNews, getNewsCategoryBySlug, getPublishedNews, listNewsCategories, listPublishedNews, listPublishedServices, listServiceCategories } from '@/domain/content/queries';
import { listAuthorOptions, newsRepo } from '@/server/db/repositories/news';
import { newsCategoriesRepo } from '@/server/db/repositories/news-categories';
import { servicesRepo } from '@/server/db/repositories/services';
import { createTestDb } from '@/server/db/testing';
import { ForbiddenError, ValidationError } from '@/server/http/errors';
import { ADMIN, MANAGER, T0 } from './helpers';

const DAY = 86_400_000;
type Db = ReturnType<typeof createTestDb>;
const ctx = (db: Db, now = T0) => ({ db, now });

describe('новости: категории, автор, расписание', () => {
  it('категория и автор сохраняются; автор-сотрудник подставляет своё имя; неизвестные категория и сотрудник отклоняются', async () => {
    const db = createTestDb();
    const staff = await createStaff({ email: 'm@shop.test', password: 'manager-password-1', role: 'manager' }, { db, now: T0 });
    const staffId = staff.staffId;
    db.prepare('UPDATE staff SET name = ? WHERE id = ?').run('Мария Иванова', staffId);
    expect(listAuthorOptions(db).map((a) => a.name)).toContain('Мария Иванова');
    const cat = (await contentOps.newsCategories.save(ADMIN, null, { name: 'События' }, ctx(db))).id;
    const { id } = await contentOps.news.save(ADMIN, null, { title: 'Открытие', status: 'published', categoryId: cat, authorStaffId: staffId, authorName: 'игнорируется' }, ctx(db));
    expect(newsRepo.get(db, id)).toMatchObject({ categoryId: cat, authorStaffId: staffId, authorName: 'Мария Иванова' });
    const text = (await contentOps.news.save(ADMIN, null, { title: 'Без сотрудника', status: 'published', authorName: 'Редакция' }, ctx(db))).id;
    expect(newsRepo.get(db, text)).toMatchObject({ authorStaffId: null, authorName: 'Редакция' });
    await expect(contentOps.news.save(ADMIN, null, { title: 'X', categoryId: 9999 }, ctx(db))).rejects.toBeInstanceOf(ValidationError);
    await expect(contentOps.news.save(ADMIN, null, { title: 'X', authorStaffId: 9999 }, ctx(db))).rejects.toBeInstanceOf(ValidationError);
  });

  it('фильтр по категории и страницы: считаются только вышедшие новости', async () => {
    const db = createTestDb();
    const a = (await contentOps.newsCategories.save(ADMIN, null, { name: 'События' }, ctx(db))).id;
    const b = (await contentOps.newsCategories.save(ADMIN, null, { name: 'Советы' }, ctx(db))).id;
    for (let i = 1; i <= 5; i++) await contentOps.news.save(ADMIN, null, { title: `Событие ${i}`, status: 'published', categoryId: a, publishedAt: T0 - i * DAY }, ctx(db));
    await contentOps.news.save(ADMIN, null, { title: 'Совет', status: 'published', categoryId: b }, ctx(db));
    await contentOps.news.save(ADMIN, null, { title: 'Черновик в категории', status: 'draft', categoryId: b }, ctx(db));
    expect(countPublishedNews({ db, now: T0 })).toBe(6);
    expect(countPublishedNews({ db, now: T0, categoryId: a })).toBe(5);
    expect(listPublishedNews({ db, now: T0, categoryId: a, limit: 2, offset: 0 }).map((n) => n.title)).toEqual(['Событие 1', 'Событие 2']);
    expect(listPublishedNews({ db, now: T0, categoryId: a, limit: 2, offset: 4 }).map((n) => n.title)).toEqual(['Событие 5']);
    expect(listNewsCategories({ db, now: T0 }).map((c) => [c.name, c.count])).toEqual([['События', 5], ['Советы', 1]]);
    expect(getNewsCategoryBySlug('sovety', { db })?.id).toBe(b);
    expect(getNewsCategoryBySlug('net', { db })).toBeNull();
  });

  it('запланированная новость выходит сама по времени; черновик не виден; предпросмотр новости по ссылке', async () => {
    const db = createTestDb();
    const { id } = await contentOps.news.save(ADMIN, null, { title: 'К выходным', status: 'scheduled', publishedAt: T0 + DAY }, ctx(db));
    await contentOps.news.save(ADMIN, null, { title: 'Не готова', status: 'draft' }, ctx(db));
    expect(getPublishedNews('k-vykhodnym', { db, now: T0 })).toBeNull();
    expect(countPublishedNews({ db, now: T0 })).toBe(0);
    expect(getPublishedNews('k-vykhodnym', { db, now: T0 + DAY })?.id).toBe(id);
    expect(countPublishedNews({ db, now: T0 + DAY })).toBe(1);
    await expect(contentOps.news.save(ADMIN, null, { title: 'Ошибка', status: 'scheduled' }, ctx(db))).rejects.toBeInstanceOf(ValidationError);
    const link = previewOps.create(ADMIN, 'news', id, ctx(db));
    expect(previewOps.consume(ADMIN, link.url.split('/').pop()!, ctx(db))).toEqual({ entity: 'news', entityId: id });
  });

  it('удаление категории оставляет новости без категории; дублирование — черновик с новым адресом', async () => {
    const db = createTestDb();
    const cat = (await contentOps.newsCategories.save(ADMIN, null, { name: 'Временная' }, ctx(db))).id;
    const { id } = await contentOps.news.save(ADMIN, null, { title: 'Новость', status: 'published', categoryId: cat }, ctx(db));
    await contentOps.newsCategories.remove(ADMIN, cat, ctx(db));
    expect(newsCategoriesRepo.get(db, cat)).toBeNull();
    expect(newsRepo.get(db, id)?.categoryId).toBeNull();
    const copy = newsRepo.get(db, (await contentOps.news.duplicate(ADMIN, id, ctx(db))).id)!;
    expect(copy).toMatchObject({ published: false, title: 'Новость (копия)' });
    expect(copy.slug).not.toBe(newsRepo.get(db, id)!.slug);
  });

  it('скрыть и показать новость из списка не трогает текст; менеджер — 403', async () => {
    const db = createTestDb();
    const { id } = await contentOps.news.save(ADMIN, null, { title: 'Текст', body: 'Важный текст', status: 'published' }, ctx(db));
    await contentOps.visibility.set(ADMIN, 'news', id, false, ctx(db));
    expect(newsRepo.get(db, id)).toMatchObject({ published: false, body: 'Важный текст' });
    await contentOps.visibility.set(ADMIN, 'news', id, true, ctx(db));
    expect(getPublishedNews('tekst', { db, now: T0 + 1 })?.body).toBe('Важный текст');
    await expect(contentOps.visibility.set(MANAGER, 'news', id, false, ctx(db))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(contentOps.visibility.set(ADMIN, 'settings', id, false, ctx(db))).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('услуги: категория, стоимость текстом', () => {
  it('стоимость — только текст админа (пусто допустимо); категория фильтрует список и существует только пока есть опубликованные услуги', async () => {
    const db = createTestDb();
    const base = listPublishedServices({ db }).length; // услуга ремонта из миграции
    const cat = (await contentOps.serviceCategories.save(ADMIN, null, { name: 'Заточка' }, ctx(db))).id;
    const { id } = await contentOps.services.save(ADMIN, null, { title: 'Заточка цепей', published: true, categoryId: cat, priceText: 'от 300 ₽' }, ctx(db));
    const free = await contentOps.services.save(ADMIN, null, { title: 'Диагностика', published: true }, ctx(db));
    expect(servicesRepo.get(db, id)?.priceText).toBe('от 300 ₽');
    expect(servicesRepo.get(db, free.id)?.priceText).toBeNull();
    expect(listPublishedServices({ db })).toHaveLength(base + 2);
    expect(listPublishedServices({ db, categoryId: cat }).map((s) => s.title)).toEqual(['Заточка цепей']);
    expect(listServiceCategories({ db }).map((c) => [c.name, c.count])).toEqual([['Заточка', 1]]);
    await expect(contentOps.services.save(ADMIN, null, { title: 'X', categoryId: 999 }, ctx(db))).rejects.toBeInstanceOf(ValidationError);
    await contentOps.visibility.set(ADMIN, 'services', id, false, ctx(db));
    expect(listServiceCategories({ db })).toEqual([]);
  });

  it('прежняя услуга «Ремонт и обслуживание садовой техники» и её тексты на месте', () => {
    const db = createTestDb();
    const repair = servicesRepo.findBySlug(db, 'remont-sadovoj-tehniki');
    expect(repair).toMatchObject({ published: true, priceText: null });
    expect(repair?.body).toContain('+7 916-655-06-06');
  });
});

describe('списки админки: серверные поиск, фильтр по статусу, сортировка и страницы', () => {
  it('новости: поиск без учёта регистра по кириллице, фильтры статуса, сортировка, пагинация', async () => {
    const db = createTestDb();
    for (let i = 1; i <= 25; i++) await contentOps.news.save(ADMIN, null, { title: `Новость ${String(i).padStart(2, '0')}`, status: i % 5 === 0 ? 'draft' : 'published', publishedAt: T0 - i * DAY }, ctx(db));
    await contentOps.news.save(ADMIN, null, { title: 'Сезон СКИДОК', status: 'scheduled', publishedAt: T0 + DAY }, ctx(db));
    const list = (o: object) => listAdminEntity('news', { page: 1, pageSize: 10, ...o }, { db, now: T0 });
    expect(list({}).total).toBe(26);
    expect(list({}).rows).toHaveLength(10);
    expect(list({ page: 3 }).rows).toHaveLength(6);
    expect(list({ q: 'скидок' }).rows.map((r) => (r as { title: string }).title)).toEqual(['Сезон СКИДОК']);
    expect(list({ status: 'draft' }).total).toBe(5);
    expect(list({ status: 'scheduled' }).total).toBe(1);
    expect(list({ status: 'published' }).total).toBe(20);
    expect((list({ sort: 'title', dir: 'asc' }).rows[0] as { title: string }).title).toBe('Новость 01');
    expect((list({ sort: 'title', dir: 'desc' }).rows[0] as { title: string }).title).toBe('Сезон СКИДОК');
    expect(list({ sort: 'drop table; --' }).total).toBe(26); // неизвестная сортировка игнорируется
  });

  it('страницы: фильтр системные/свои/скрытые; акции: статусы по датам', async () => {
    const db = createTestDb();
    await contentOps.pages.save(ADMIN, null, { title: 'Своя', status: 'published' }, ctx(db));
    const faq = (db.prepare("SELECT id FROM pages WHERE key = 'faq'").get() as { id: number }).id;
    await contentOps.pages.setHidden(ADMIN, faq, true, ctx(db));
    const pages = (status: string) => listAdminEntity('pages', { page: 1, pageSize: 50, status }, { db, now: T0 }).total;
    expect(pages('system')).toBe(6);
    expect(pages('custom')).toBe(1);
    expect(pages('hidden')).toBe(1);
    await contentOps.promotions.save(ADMIN, null, { title: 'Идёт', published: true, startsAt: T0 - DAY, endsAt: T0 + DAY }, ctx(db));
    await contentOps.promotions.save(ADMIN, null, { title: 'Прошла', published: true, endsAt: T0 - DAY }, ctx(db));
    await contentOps.promotions.save(ADMIN, null, { title: 'Будет', published: true, startsAt: T0 + DAY }, ctx(db));
    const promos = (status: string) => listAdminEntity('promotions', { page: 1, pageSize: 50, status }, { db, now: T0 }).rows.map((r) => (r as { title: string }).title);
    expect(promos('active')).toEqual(['Идёт']);
    expect(promos('finished')).toEqual(['Прошла']);
    expect(promos('upcoming')).toEqual(['Будет']);
  });
});
