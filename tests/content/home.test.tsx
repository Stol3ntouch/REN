import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { contentOps } from '@/domain/content/ops';
import { getHomeData } from '@/domain/content/home';
import { setSetting } from '@/domain/content/settings';
import { createTestDb } from '@/server/db/testing';
import { HomeView } from '@/ui/home/HomeView';
import { ADMIN, T0, insertProduct, pngBytes, withUploadsDir } from './helpers';

const uploads = withUploadsDir();
const NOW = new Date(T0);
const recent = new Date(T0 - 3 * 86_400_000).toISOString();

describe('главная без данных', () => {
  it('скрывает пустые блоки; из начальных данных — только услуга по ремонту, текст «О компании» и карта (F5)', async () => {
    const db = createTestDb();
    const data = await getHomeData({ db, now: NOW });
    expect(data.slides).toEqual([]);
    expect(data.categories).toEqual([]);
    expect(data.newProducts).toEqual([]);
    expect(data.popularProducts).toEqual([]);
    expect(data.promoProducts).toEqual([]);
    expect(data.promotions).toEqual([]);
    // F5 (G06): единственная начальная услуга — «Ремонт и обслуживание садовой техники»
    expect(data.services.map((s) => s.slug)).toEqual(['remont-sadovoj-tehniki']);
    expect(data.reviews).toEqual([]);
    expect(data.news).toEqual([]);
    expect(data.catalogProducts).toEqual([]);

    const html = renderToStaticMarkup(<HomeView data={data} />);
    expect(html).toMatch(/<h1/);
    expect(html).not.toContain('home-slider');
    for (const title of ['Популярные категории', 'Новинки', 'Хиты', 'Популярные товары', 'Товары каталога', 'Акции', 'Отзывы о компании', 'Новости']) {
      expect(html).not.toContain(`>${title}<`);
    }
    // герой с слоганом пользователя и полоса преимуществ есть всегда; рейтингов и звёзд без отзывов нет
    expect(html).toContain('профессиональный подход к садовой технике:');
    expect(html).toContain('подберём новую, починим старую');
    expect(html).toContain('Перейти в каталог');
    expect(html).toContain('Заявка на ремонт на сайте');
    expect(html).not.toContain('★');
    expect(html).not.toContain('review-card');
    expect(html).not.toContain('home-badge');
    // F5: «О компании» — текст из брифа (без меток), услуга в списке, карта по координатам из миграции 0952
    expect(html).toContain('>Услуги<');
    expect(html).toContain('Ремонт и обслуживание садовой техники');
    expect(html).toContain('О компании');
    expect(html).not.toContain('ТЕКСТ О КОМПАНИИ');
    expect(html).toContain('[EMAIL — впиши]'); // email владелец не давал — метка остаётся
    expect(html).toContain('Талдом, Садовый переулок д10');
    expect(html).toContain('shop-map__canvas');
    expect(html).toContain('https://www.openstreetmap.org/directions?to=56.7299446');
    expect(html).toContain('Построить маршрут');
  });
});

describe('главная: бейджи и плитки категорий', () => {
  it('«Акция» только у товара с реальной скидкой, «Новинка» — только по firstSeenAt', async () => {
    const db = createTestDb();
    insertProduct(db, { n: 1, firstSeenAt: recent, featured: true });
    insertProduct(db, { n: 2, discount: 70_000, featured: true });
    insertProduct(db, { n: 3 });
    const html = renderToStaticMarkup(<HomeView data={await getHomeData({ db, now: NOW })} />);
    const items = html.split('<li class="home-products__item">').slice(1).map((c) => c.split('</li>')[0] as string);
    const of = (name: string) => items.filter((c) => c.includes(`>${name}</a>`));
    expect(of('Товар 1').length).toBeGreaterThan(0);
    for (const c of of('Товар 1')) expect(c).not.toContain('home-badge--sale');
    expect(of('Товар 2').length).toBeGreaterThan(0);
    for (const c of of('Товар 2')) expect(c).toContain('home-badge--sale');
    expect(of('Товар 1').some((c) => c.includes('home-badge--new'))).toBe(true);
    expect(of('Товар 2').some((c) => c.includes('home-badge--new'))).toBe(false);
    expect(html).not.toContain('>Товар 3<'); // без featured, скидки и новизны на главную не попадает
  });

  it('плитка категории берёт реальное фото первого товара; без фото — нейтральная иконка', async () => {
    const db = createTestDb();
    const id = insertProduct(db, { n: 1 });
    db.prepare("INSERT INTO product_images (product_id, url_source, path, sort) VALUES (?, 'https://champion.ru/a.jpg', NULL, 0)").run(id);
    const withPhoto = renderToStaticMarkup(<HomeView data={await getHomeData({ db, now: NOW })} />);
    const tile = withPhoto.slice(withPhoto.indexOf('category-tile')).split('</ul>')[0] as string;
    expect(tile).toContain('https://champion.ru/a.jpg');
    expect(tile).toContain('1 товар');

    const db2 = createTestDb();
    insertProduct(db2, { n: 1 });
    const noPhoto = renderToStaticMarkup(<HomeView data={await getHomeData({ db: db2, now: NOW })} />);
    const tile2 = noPhoto.slice(noPhoto.indexOf('category-tile')).split('</ul>')[0] as string;
    expect(tile2).toContain('product-image--empty');
    expect(tile2).not.toContain('<img');
  });

  it('нет хитов, акций и новинок — вместо вкладок запасной блок «Товары каталога»', async () => {
    const db = createTestDb();
    insertProduct(db, { n: 1 });
    insertProduct(db, { n: 2 });
    const data = await getHomeData({ db, now: NOW });
    expect(data.catalogProducts.map((p) => p.name)).toEqual(['Товар 1', 'Товар 2']);
    const html = renderToStaticMarkup(<HomeView data={data} />);
    expect(html).toContain('>Товары каталога<');
    expect(html).not.toContain('role="tablist"');
  });
});

describe('главная с данными', () => {
  it('показывает все блоки', async () => {
    const db = createTestDb();
    const ctx = { db, now: T0, uploadsDir: uploads.dir() };
    for (let i = 1; i <= 2; i++) {
      await contentOps.slides.save(ADMIN, null, { title: `Слайд ${i}`, active: true, image: { bytes: await pngBytes(1200, 400) }, imageAlt: 'Баннер' }, ctx);
    }
    await contentOps.promotions.save(ADMIN, null, { title: 'Весенняя акция', summary: 'Условия', published: true }, ctx);
    await contentOps.services.save(ADMIN, null, { title: 'Ремонт триммеров', summary: 'Диагностика', published: true }, ctx);
    await contentOps.reviews.save(ADMIN, null, { authorName: 'Клиент из админки', body: 'Текст отзыва', published: true }, ctx);
    await contentOps.news.save(ADMIN, null, { title: 'Новость', published: true }, ctx);
    setSetting('latitude', '55.751244', { db });
    setSetting('longitude', '37.618423', { db });
    setSetting('address', 'г. Тест, ул. Садовая, 1', { db });

    insertProduct(db, { n: 1, firstSeenAt: recent });
    insertProduct(db, { n: 2, firstSeenAt: recent });
    insertProduct(db, { n: 3, discount: 80_000, featured: true });
    insertProduct(db, { n: 4 });

    const data = await getHomeData({ db, now: NOW });
    expect(data.slides).toHaveLength(2);
    expect(data.categories.map((c) => c.name)).toEqual(['Садовая техника']);
    expect(data.newProducts.map((p) => p.name)).toEqual(['Товар 2', 'Товар 1']);
    expect(data.promoProducts.map((p) => p.name)).toEqual(['Товар 3']);
    expect(data.popularProducts.map((p) => p.name)).toEqual(['Товар 3']); // избранные админом (featured)

    const html = renderToStaticMarkup(<HomeView data={data} />);
    expect(html).toContain('home-slider');
    for (const title of ['Популярные категории', 'Хиты', 'Акции', 'Новинки', 'Популярные товары', 'Услуги', 'Отзывы о компании', 'Новости']) {
      expect(html).toContain(`>${title}<`);
    }
    expect(html).toContain('home-banner'); // баннер из реальной акции
    expect(html).not.toContain('★'); // оценку отзыву админ не ставил
    expect(html).toContain('Построить маршрут');
    expect(html).not.toContain('Адрес не указан');
  });

  it('«Новинки» скрыты, пока новым считается весь каталог (первая загрузка); популярные без продаж и без избранных скрыты', async () => {
    const db = createTestDb();
    insertProduct(db, { n: 1, firstSeenAt: recent });
    insertProduct(db, { n: 2, firstSeenAt: recent });
    const data = await getHomeData({ db, now: NOW });
    expect(data.newProducts).toEqual([]);
    expect(data.popularProducts).toEqual([]);
  });

  it('неопубликованные товары и выключенные акции/услуги/отзывы на главную не попадают', async () => {
    const db = createTestDb();
    insertProduct(db, { n: 1, discount: 50_000, published: false });
    await contentOps.promotions.save(ADMIN, null, { title: 'Черновик', published: false }, { db, now: T0 });
    await contentOps.reviews.save(ADMIN, null, { authorName: 'А', body: 'Б', published: false }, { db, now: T0 });
    await contentOps.services.save(ADMIN, null, { title: 'Скрыта', published: false }, { db, now: T0 });
    const data = await getHomeData({ db, now: NOW });
    expect(data.promoProducts).toEqual([]);
    expect(data.promotions).toEqual([]);
    expect(data.reviews).toEqual([]);
    expect(data.services.map((s) => s.title)).toEqual(['Ремонт и обслуживание садовой техники']); // начальная услуга (F5), «Скрыта» не попала
  });
});
