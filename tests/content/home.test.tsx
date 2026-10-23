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
  it('скрывает пустые блоки, показывает метки вместо выдуманного', async () => {
    const db = createTestDb();
    const data = await getHomeData({ db, now: NOW });
    expect(data.slides).toEqual([]);
    expect(data.categories).toEqual([]);
    expect(data.newProducts).toEqual([]);
    expect(data.popularProducts).toEqual([]);
    expect(data.promoProducts).toEqual([]);
    expect(data.promotions).toEqual([]);
    expect(data.services).toEqual([]);
    expect(data.reviews).toEqual([]);
    expect(data.news).toEqual([]);

    const html = renderToStaticMarkup(<HomeView data={data} />);
    expect(html).toMatch(/<h1/);
    expect(html).not.toContain('home-slider');
    for (const title of ['Популярные категории', 'Новинки', 'Популярные товары', 'Акционные товары', 'Акции', 'Услуги', 'Отзывы о компании', 'Новости']) {
      expect(html).not.toContain(`>${title}<`);
    }
    // блоки «О компании» и «Контакты» остаются: тексты — метки, карты нет
    expect(html).toContain('О компании');
    expect(html).toContain('впиши]');
    expect(html).toContain('Адрес не указан');
    expect(html).not.toContain('Построить маршрут');
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
    for (const title of ['Популярные категории', 'Новинки', 'Популярные товары', 'Акционные товары', 'Акции', 'Услуги', 'Отзывы о компании', 'Новости']) {
      expect(html).toContain(`>${title}<`);
    }
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
    expect(data.services).toEqual([]);
  });
});
