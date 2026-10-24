import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getCategoryImage } from '@/domain/catalog/category-images';
import { getCategoryBreadcrumbs, getCategoryTree, getSiblingCategories } from '@/domain/catalog/categories';
import { getFacets } from '@/domain/catalog/facets';
import { getProductBySlug } from '@/domain/catalog/product';
import { searchProducts } from '@/domain/catalog/search';
import { applyImport } from '@/importing/yml/apply';
import { parseYml } from '@/importing/yml/parse';
import { planImport } from '@/importing/yml/plan';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { createTestDb } from '@/server/db/testing';
import { ymlXml } from '../importing/helpers';
import { addCategory, addProduct, baseQuery } from '../catalog/helpers';

// «Запрос» React Server Components: cache() помнит результат, пока не начался следующий запрос.
const requestScope = vi.hoisted(() => ({ memo: new Map<unknown, Map<unknown, unknown>>() }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      return (...args: A): R => {
        let perFn = requestScope.memo.get(fn);
        if (!perFn) requestScope.memo.set(fn, (perFn = new Map()));
        const key = args[0];
        if (!perFn.has(key)) perFn.set(key, fn(...args));
        return perFn.get(key) as R;
      };
    },
  };
});

describe('описание товара очищается на выводе', () => {
  it('script, img и onerror из БД не попадают в HTML карточки', async () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Садовая техника', 'sad');
    addProduct(db, {
      name: 'Триммер',
      slug: 'trimmer-x',
      categoryId: cat,
      description: '<p>a</p><img src=x onerror=alert(1)><script>x</script>',
    });
    const page = await getProductBySlug('trimmer-x', { db });
    const html = page?.descriptionHtml ?? '';
    expect(html).toContain('<p>a</p>');
    expect(html).not.toMatch(/<img|<script|onerror/i);
  });

  it('пустое после очистки описание — null', async () => {
    const db = createTestDb();
    const cat = addCategory(db, 'Садовая техника', 'sad');
    addProduct(db, { name: 'Триммер', slug: 'trimmer-y', categoryId: cat, description: '<script>x</script>' });
    expect((await getProductBySlug('trimmer-y', { db }))?.descriptionHtml).toBeNull();
  });
});

describe('parseVariants объявлена один раз', () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(n)) out.push(p);
    }
    return out;
  };
  it('в src ровно одно объявление function parseVariants', () => {
    const src = resolve(__dirname, '../../src');
    const hits = walk(src).filter((f) => /function parseVariants\b/.test(readFileSync(f, 'utf8')));
    expect(hits.map((h) => h.replace(src, ''))).toHaveLength(1);
  });
});

describe('дерево категорий читается один раз на запрос', () => {
  it('для страницы категории categoriesRepo.listAll вызывается не более одного раза', async () => {
    const db = createTestDb();
    const root = addCategory(db, 'Садовая техника', 'sad');
    const sub = addCategory(db, 'Триммеры', 'trim', root);
    addCategory(db, 'Косилки', 'kosilki', root);
    addProduct(db, { name: 'Триммер 1', categoryId: sub, attrs: { Тип: 'a' } });
    addProduct(db, { name: 'Триммер 2', categoryId: sub, attrs: { Тип: 'b' } });
    addProduct(db, { name: 'Триммер 3', categoryId: sub, attrs: { Тип: 'a' } });

    requestScope.memo.clear(); // новый «запрос»
    const spy = vi.spyOn(categoriesRepo, 'listAll');
    // то же, что делает app/(shop)/catalog/[slug]/page.tsx
    const result = await searchProducts({ ...baseQuery, categorySlug: 'trim', filters: {}, pageSize: 20 }, { db });
    const [facets, tree, crumbs, siblings] = await Promise.all([
      getFacets(sub, { filters: {} }, { db }),
      getCategoryTree({ db }),
      getCategoryBreadcrumbs('trim', { db }),
      getSiblingCategories('trim', { db }),
    ]);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    // результат страницы не меняется
    expect(result.total).toBe(3);
    expect(facets.filter((f) => f.kind === 'attribute').map((f) => f.name)).toEqual(['Тип']);
    expect(tree[0]?.children.map((c) => c.slug)).toEqual(['trim', 'kosilki']);
    expect(crumbs.map((c) => c.name)).toEqual(['Садовая техника', 'Триммеры']);
    expect(siblings.map((s) => s.slug)).toEqual(['kosilki']);
    spy.mockRestore();
  });
});

describe('кэш картинок категорий сбрасывается после импорта', () => {
  it('плитка категории сразу показывает новое фото', async () => {
    const db = createTestDb();
    const run = async (picture: string) => {
      const xml = ymlXml({ offers: [{ id: '100', categoryId: '11', pictures: [picture] }] });
      return applyImport(planImport(parseYml(xml), db, { fileName: 't.yml' }), db, {});
    };
    await run('https://champion.ru/old.jpg');
    const cat = categoriesRepo.listAll(db).find((c) => c.name === 'Бензиновые генераторы')!;
    expect(getCategoryImage(cat.id, { db })?.src).toBe('https://champion.ru/old.jpg'); // кэш заполнен
    await run('https://champion.ru/new.jpg');
    expect(getCategoryImage(cat.id, { db })?.src).toBe('https://champion.ru/new.jpg');
  });

  it('и после скачивания фото (локальная копия вместо внешней ссылки)', async () => {
    const db = createTestDb();
    const xml = ymlXml({ offers: [{ id: '100', categoryId: '11', pictures: ['https://champion.ru/a.jpg'] }] });
    const plan = () => planImport(parseYml(xml), db, { fileName: 't.yml' });
    await applyImport(plan(), db, {});
    const cat = categoriesRepo.listAll(db).find((c) => c.name === 'Бензиновые генераторы')!;
    expect(getCategoryImage(cat.id, { db })?.remote).toBe(true);
    await applyImport(plan(), db, {
      images: {
        fetchImage: async () => ({ bytes: new Uint8Array([1]) }),
        storeImage: async () => ({ path: 'ab/full.webp', variants: [{ key: 'card', width: 480, height: 360, path: 'ab/card.webp' }], width: 1, height: 1 }),
      },
    });
    expect(getCategoryImage(cat.id, { db })?.src).toBe('/api/catalog/media/ab/card.webp');
  });
});
