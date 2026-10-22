import { describe, expect, it } from 'vitest';
import { getCategoryBreadcrumbs, getCategoryTree } from '@/domain/catalog/categories';
import { addCategory, addProduct, createTestDb } from './helpers';

describe('getCategoryTree', () => {
  it('строит дерево с числом товаров вместе с подкатегориями, без неопубликованных', async () => {
    const db = createTestDb();
    const garden = addCategory(db, 'Садовая техника', 'sadovaya');
    const trimmers = addCategory(db, 'Триммеры', 'trimmery', garden);
    const mowers = addCategory(db, 'Газонокосилки', 'gazonokosilki', garden);
    addCategory(db, 'Насосы', 'nasosy');
    addProduct(db, { name: 'a', categoryId: garden });
    addProduct(db, { name: 'b', categoryId: trimmers });
    addProduct(db, { name: 'c', categoryId: trimmers });
    addProduct(db, { name: 'd', categoryId: trimmers, published: false });
    addProduct(db, { name: 'e', categoryId: mowers });
    const tree = await getCategoryTree({ db });
    expect(tree.map((n) => [n.slug, n.productCount])).toEqual([
      ['sadovaya', 4],
      ['nasosy', 0],
    ]);
    expect(tree[0]?.children.map((n) => [n.slug, n.productCount, n.parentId])).toEqual([
      ['trimmery', 2, garden],
      ['gazonokosilki', 1, garden],
    ]);
    expect(tree[1]?.children).toEqual([]);
  });

  it('хлебные крошки: от корня к категории', async () => {
    const db = createTestDb();
    const a = addCategory(db, 'Садовая техника', 'sadovaya');
    addCategory(db, 'Триммеры', 'trimmery', a);
    expect(await getCategoryBreadcrumbs('trimmery', { db })).toEqual([
      { name: 'Садовая техника', href: '/catalog/sadovaya' },
      { name: 'Триммеры', href: '/catalog/trimmery' },
    ]);
    expect(await getCategoryBreadcrumbs('net', { db })).toEqual([]);
  });
});
