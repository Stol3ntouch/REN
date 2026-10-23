import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { contentOps } from '@/domain/content/ops';
import { getPageByKey, getPageBySlug, pagePath } from '@/domain/content/queries';
import { listPublicUrls } from '@/domain/content/urls';
import { createTestDb } from '@/server/db/testing';
import { ValidationError } from '@/server/http/errors';
import { ContentPageView } from '@/ui/home/ContentPageView';
import { ShopMap } from '@/ui/map/ShopMapBlock';
import { ADMIN, T0 } from './helpers';

describe('редактируемые страницы', () => {
  it('правовая страница показывает видимую метку-черновик; снять её может только админ при редактировании', async () => {
    const db = createTestDb();
    const page = getPageByKey('privacy', { db })!;
    const html = renderToStaticMarkup(<ContentPageView page={page} />);
    expect(html).toContain('ЧЕРНОВИК — проверить юристом');

    await contentOps.pages.save(ADMIN, page.id, { title: page.title, slug: page.slug, body: 'Проверено', legalDraft: false }, { db, now: T0 });
    const after = getPageByKey('privacy', { db })!;
    expect(renderToStaticMarkup(<ContentPageView page={after} />)).not.toContain('ЧЕРНОВИК');
  });

  it('метки-заглушки в тексте страницы выделены, текст не интерпретируется как HTML', async () => {
    const db = createTestDb();
    const page = getPageByKey('about', { db })!;
    await contentOps.pages.save(ADMIN, page.id, { title: 'О нас', slug: 'about', body: '<script>alert(1)</script>\n\nАбзац [АДРЕС — впиши]', legalDraft: false }, { db, now: T0 });
    const html = renderToStaticMarkup(<ContentPageView page={getPageByKey('about', { db })!} />);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toMatch(/class="placeholder"[^>]*>\[АДРЕС — впиши\]/);
  });

  it('slug страницы редактируется, но должен быть уникальным и непустым', async () => {
    const db = createTestDb();
    const faq = getPageByKey('faq', { db })!;
    const terms = getPageByKey('terms', { db })!;
    await contentOps.pages.save(ADMIN, faq.id, { title: faq.title, slug: 'Частые вопросы', body: 'x', legalDraft: true }, { db, now: T0 });
    expect(getPageBySlug('chastye-voprosy', { db })?.key).toBe('faq');
    await expect(contentOps.pages.save(ADMIN, terms.id, { title: 'T', slug: 'chastye-voprosy', body: 'x', legalDraft: true }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(contentOps.pages.save(ADMIN, terms.id, { title: 'T', slug: '!!!', body: 'x', legalDraft: true }, { db, now: T0 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('адреса: /about и /privacy фиксированы, остальные — /pages/<slug>', () => {
    const db = createTestDb();
    expect(pagePath(getPageByKey('about', { db })!)).toBe('/about');
    expect(pagePath(getPageByKey('privacy', { db })!)).toBe('/privacy');
    expect(pagePath(getPageByKey('delivery', { db })!)).toBe('/pages/delivery-payment');
  });
});

describe('карта', () => {
  it('без координат — «Адрес не указан», без ссылки на маршрут', () => {
    const html = renderToStaticMarkup(<ShopMap latitude={null} longitude={null} address={null} />);
    expect(html).toContain('Адрес не указан');
    expect(html).not.toContain('Построить маршрут');
  });

  it('с координатами — контейнер карты и ссылка «Построить маршрут» на OSM', () => {
    const html = renderToStaticMarkup(<ShopMap latitude={55.75} longitude={37.61} address="ул. Садовая, 1" />);
    expect(html).toContain('Построить маршрут');
    expect(html).toContain('https://www.openstreetmap.org/directions?to=55.75%2C37.61');
    expect(html).not.toContain('Адрес не указан');
  });
});

describe('публичные URL для sitemap (T11)', () => {
  it('содержит страницы и только опубликованное содержимое; пустые разделы не попадают', async () => {
    const db = createTestDb();
    const base = listPublicUrls({ db }).map((u) => u.path);
    expect(base).toEqual(expect.arrayContaining(['/', '/about', '/contacts', '/privacy', '/services', '/buyers', '/pages/delivery-payment']));
    expect(base).not.toContain('/news');
    expect(base).not.toContain('/promotions');

    await contentOps.news.save(ADMIN, null, { title: 'Открытие сезона', published: true }, { db, now: T0 });
    await contentOps.news.save(ADMIN, null, { title: 'Черновик новости', published: false }, { db, now: T0 });
    await contentOps.services.save(ADMIN, null, { title: 'Заточка цепей', published: true }, { db, now: T0 });
    const after = listPublicUrls({ db }).map((u) => u.path);
    expect(after).toContain('/news');
    expect(after).toContain('/news/otkrytie-sezona');
    expect(after).not.toContain('/news/chernovik-novosti');
    expect(after).toContain('/services/zatochka-tsepey');
  });
});
