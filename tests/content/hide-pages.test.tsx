import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import { getHomeData } from '@/domain/content/home';
import { contentOps } from '@/domain/content/ops';
import { listAdminItems } from '@/domain/content/admin-view';
import {
  countPublishedNews,
  getPageByKey,
  getPageBySlug,
  getPublishedNews,
  getPublishedPromotion,
  getPublishedService,
  isSectionHidden,
  listActivePromotions,
  listPages,
  listPublishedNews,
  listPublishedServices,
} from '@/domain/content/queries';
import { loadShellContext } from '@/domain/content/shell';
import { listPublicUrls } from '@/domain/content/urls';
import { PageVisibilityControl, SectionVisibilityControl } from '@/app/admin/(panel)/content/VisibilityControls';
import { HomeView } from '@/ui/home/HomeView';
import { servicesRepo } from '@/server/db/repositories/services';
import type { Db } from '@/server/db/connection';
import { createTestDb } from '@/server/db/testing';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { ADMIN, MANAGER, T0 } from './helpers';

const ctx = (db: Db) => ({ db, now: T0 });
const pageId = (db: Db, key: string) => (db.prepare('SELECT id FROM pages WHERE key = ?').get(key) as { id: number }).id;
const navHrefs = (db: Db) => (loadShellContext({ db, now: T0 }).nav ?? []).map((i) => i.href);
const footerHrefs = (db: Db) => {
  const s = loadShellContext({ db, now: T0 });
  return [...(s.buyerLinks ?? []), ...(s.companyLinks ?? [])].map((i) => i.href);
};
const urls = (db: Db) => listPublicUrls({ db, now: T0 }).map((u) => u.path);

describe('скрытие страниц сайта', () => {
  it('менеджер — 403, без сессии — 401; страница остаётся видимой, аудита нет', async () => {
    const db = createTestDb();
    const id = pageId(db, 'delivery');
    await expect(contentOps.pages.setHidden(MANAGER, id, true, ctx(db))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(contentOps.pages.setHidden(null, id, true, ctx(db))).rejects.toBeInstanceOf(UnauthorizedError);
    expect(getPageByKey('delivery', { db })).not.toBeNull();
    expect(audit.list({ action: 'page.visibility' }, { db })).toEqual([]);
  });

  it('проверка входа: неизвестная страница — 404, неверный id или признак — ошибка проверки', async () => {
    const db = createTestDb();
    await expect(contentOps.pages.setHidden(ADMIN, 99999, true, ctx(db))).rejects.toBeInstanceOf(NotFoundError);
    await expect(contentOps.pages.setHidden(ADMIN, 0, true, ctx(db))).rejects.toBeInstanceOf(ValidationError);
    await expect(contentOps.pages.setHidden(ADMIN, pageId(db, 'faq'), 'да' as unknown as boolean, ctx(db))).rejects.toBeInstanceOf(ValidationError);
  });

  it('скрытая страница: не находится по slug и ключу, нет в списке, меню, подвале и sitemap; в админке видна с пометкой', async () => {
    const db = createTestDb();
    const id = pageId(db, 'delivery');
    expect(footerHrefs(db)).toContain('/pages/delivery-payment');
    expect(urls(db)).toContain('/pages/delivery-payment');

    await expect(contentOps.pages.setHidden(ADMIN, id, true, ctx(db))).resolves.toEqual({ changed: true });
    expect(getPageBySlug('delivery-payment', { db })).toBeNull();
    expect(getPageByKey('delivery', { db })).toBeNull();
    expect(listPages({ db }).map((p) => p.id)).not.toContain(id);
    expect(footerHrefs(db)).not.toContain('/pages/delivery-payment');
    expect(urls(db)).not.toContain('/pages/delivery-payment');
    const item = listAdminItems('pages', { db }).find((i) => i.id === id)!;
    expect(item.note).toContain('скрыта');
    expect(item.hidden).toBe(true);

    const rows = audit.list({ action: 'page.visibility' }, { db });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: 'content_pages', entityId: String(id), actorId: '1', before: { hidden: false }, after: { hidden: true } });
    await expect(contentOps.pages.setHidden(ADMIN, id, true, ctx(db))).resolves.toEqual({ changed: false });
    expect(audit.list({ action: 'page.visibility' }, { db })).toHaveLength(1);

    await contentOps.pages.setHidden(ADMIN, id, false, ctx(db));
    expect(getPageBySlug('delivery-payment', { db })).not.toBeNull();
    expect(footerHrefs(db)).toContain('/pages/delivery-payment');
    expect(urls(db)).toContain('/pages/delivery-payment');
  });

  it('«О компании»: пропадает из меню, подвала, sitemap и блока на главной; сохранение страницы не возвращает её', async () => {
    const db = createTestDb();
    const id = pageId(db, 'about');
    expect(navHrefs(db)).toContain('/about');
    expect((await getHomeData({ db, now: new Date(T0) })).about).not.toBeNull();

    await contentOps.pages.setHidden(ADMIN, id, true, ctx(db));
    expect(navHrefs(db)).not.toContain('/about');
    expect(footerHrefs(db)).not.toContain('/about');
    expect(urls(db)).not.toContain('/about');
    expect((await getHomeData({ db, now: new Date(T0) })).about).toBeNull();
    const html = renderToStaticMarkup(<HomeView data={await getHomeData({ db, now: new Date(T0) })} />);
    expect(html).not.toContain('href="/about"');
    expect(html).not.toContain('Подробнее о компании');

    const row = db.prepare('SELECT title, slug, body FROM pages WHERE id = ?').get(id) as { title: string; slug: string; body: string };
    await contentOps.pages.save(ADMIN, id, { title: row.title, slug: row.slug, body: row.body, legalDraft: false }, ctx(db));
    expect(getPageByKey('about', { db })).toBeNull();
  });

  it('политика ПДн (на неё ссылаются формы) скрыться не может: серверная ошибка, страница на месте', async () => {
    const db = createTestDb();
    const id = pageId(db, 'privacy');
    await expect(contentOps.pages.setHidden(ADMIN, id, true, ctx(db))).rejects.toThrow(/форм/);
    await expect(contentOps.pages.setHidden(ADMIN, id, true, ctx(db))).rejects.toBeInstanceOf(ValidationError);
    expect(getPageByKey('privacy', { db })).not.toBeNull();
    expect(footerHrefs(db)).toContain('/privacy');
    expect(audit.list({ action: 'page.visibility' }, { db })).toEqual([]);
    // «показать» защищённой страницы допустимо (на случай, если скрыта прямой правкой данных)
    db.prepare('UPDATE pages SET hidden_by_admin = 1 WHERE id = ?').run(id);
    await expect(contentOps.pages.setHidden(ADMIN, id, false, ctx(db))).resolves.toEqual({ changed: true });
  });

  it('список в админке помечает страницу как нескрываемую', () => {
    const db = createTestDb();
    const items = listAdminItems('pages', { db });
    expect(items.find((i) => i.id === pageId(db, 'privacy'))!.hideLocked).toBe(true);
    expect(items.find((i) => i.id === pageId(db, 'faq'))!.hideLocked).toBeFalsy();
  });
});

describe('разделы с записями: новости, акции, услуги', () => {
  async function seeded() {
    const db = createTestDb();
    const { id: newsId } = await contentOps.news.save(ADMIN, null, { title: 'Открытие сезона', slug: 'sezon', published: true }, ctx(db));
    await contentOps.promotions.save(ADMIN, null, { title: 'Весенняя акция', slug: 'vesna', published: true }, ctx(db));
    return { db, newsId };
  }

  it('права: менеджер — 403, без сессии — 401; неизвестный раздел — ошибка проверки', async () => {
    const { db } = await seeded();
    await expect(contentOps.sections.setHidden(MANAGER, 'news', true, ctx(db))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(contentOps.sections.setHidden(null, 'news', true, ctx(db))).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(contentOps.sections.setHidden(ADMIN, 'privacy' as 'news', true, ctx(db))).rejects.toBeInstanceOf(ValidationError);
    expect(isSectionHidden('news', { db })).toBe(false);
  });

  it('скрытый раздел новостей: пустой список, запись — null (404), нет в меню, подвале, sitemap и на главной; записи не удалены', async () => {
    const { db } = await seeded();
    expect(navHrefs(db)).toContain('/news');
    expect(urls(db)).toContain('/news/sezon');

    await expect(contentOps.sections.setHidden(ADMIN, 'news', true, ctx(db))).resolves.toEqual({ changed: true });
    expect(isSectionHidden('news', { db })).toBe(true);
    expect(countPublishedNews({ db })).toBe(0);
    expect(listPublishedNews({ db })).toEqual([]);
    expect(getPublishedNews('sezon', { db })).toBeNull();
    expect(navHrefs(db)).not.toContain('/news');
    expect(footerHrefs(db)).not.toContain('/news');
    expect(urls(db)).not.toContain('/news');
    expect(urls(db)).not.toContain('/news/sezon');
    expect((await getHomeData({ db, now: new Date(T0) })).news).toEqual([]);
    expect((db.prepare('SELECT COUNT(*) AS n FROM news').get() as { n: number }).n).toBe(1);

    const rows = audit.list({ action: 'section.visibility' }, { db });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: 'content_section', entityId: 'news', before: { hidden: false }, after: { hidden: true } });
    await expect(contentOps.sections.setHidden(ADMIN, 'news', true, ctx(db))).resolves.toEqual({ changed: false });

    await contentOps.sections.setHidden(ADMIN, 'news', false, ctx(db));
    expect(getPublishedNews('sezon', { db })).not.toBeNull();
    expect(navHrefs(db)).toContain('/news');
  });

  it('скрытый раздел акций: список и страница акции недоступны, нет в меню и sitemap', async () => {
    const { db } = await seeded();
    expect(listActivePromotions({ db, now: T0 })).toHaveLength(1);
    await contentOps.sections.setHidden(ADMIN, 'promotions', true, ctx(db));
    expect(listActivePromotions({ db, now: T0 })).toEqual([]);
    expect(getPublishedPromotion('vesna', { db })).toBeNull();
    expect(navHrefs(db)).not.toContain('/promotions');
    expect(footerHrefs(db)).not.toContain('/promotions');
    expect(urls(db)).not.toContain('/promotions');
    expect(urls(db)).not.toContain('/promotions/vesna');
    expect((await getHomeData({ db, now: new Date(T0) })).promotions).toEqual([]);
    await contentOps.sections.setHidden(ADMIN, 'promotions', false, ctx(db));
    expect(getPublishedPromotion('vesna', { db })).not.toBeNull();
  });

  it('скрытый раздел услуг: список, услуга, меню, подвал, sitemap и главная', async () => {
    const { db } = await seeded();
    const service = servicesRepo.list(db, 'published = 1')[0]!;
    expect(navHrefs(db)).toContain('/services');
    expect(getPublishedService(service.slug, { db })).not.toBeNull();

    await contentOps.sections.setHidden(ADMIN, 'services', true, ctx(db));
    expect(listPublishedServices({ db })).toEqual([]);
    expect(getPublishedService(service.slug, { db })).toBeNull();
    expect(navHrefs(db)).not.toContain('/services');
    expect(footerHrefs(db)).not.toContain('/services');
    expect(urls(db)).not.toContain('/services');
    expect(urls(db)).not.toContain(`/services/${service.slug}`);
    expect((await getHomeData({ db, now: new Date(T0) })).services).toEqual([]);
  });

  it('пустой раздел услуг тоже уходит из меню, пока нет опубликованных услуг', () => {
    const db = createTestDb();
    expect(navHrefs(db)).toContain('/services');
    db.prepare('UPDATE services SET published = 0').run();
    expect(navHrefs(db)).not.toContain('/services');
  });

  it('у записей есть признак публикации, который виден в списке админки', async () => {
    const { db } = await seeded();
    expect(listAdminItems('news', { db })[0]!.note).toContain('опубликована');
    expect(listAdminItems('promotions', { db })[0]!.note).toContain('опубликована');
    expect(listAdminItems('services', { db }).every((i) => /опубликована|скрыта/.test(i.note))).toBe(true);
  });
});

describe('админка: переключатели', () => {
  it('страница: кнопка «Скрыть»/«Показать»; для политики — неактивная с пояснением', () => {
    const hide = renderToStaticMarkup(<PageVisibilityControl id={5} hidden={false} />);
    const show = renderToStaticMarkup(<PageVisibilityControl id={5} hidden />);
    const locked = renderToStaticMarkup(<PageVisibilityControl id={7} hidden={false} locked />);
    expect(hide).toContain('Скрыть');
    expect(hide).not.toContain('disabled');
    expect(show).toContain('Показать');
    expect(locked).toContain('disabled');
    expect(locked).toMatch(/форм/);
  });

  it('раздел: показывает состояние и предлагает противоположное действие', () => {
    const shown = renderToStaticMarkup(<SectionVisibilityControl section="news" hidden={false} />);
    const hidden = renderToStaticMarkup(<SectionVisibilityControl section="news" hidden />);
    expect(shown).toContain('Раздел показан');
    expect(shown).toContain('Скрыть раздел');
    expect(hidden).toContain('Раздел скрыт');
    expect(hidden).toContain('Показать раздел');
  });
});
