import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getCategoryTree } from '@/domain/catalog/categories';
import { CategoryTiles } from '@/ui/catalog/CategoryTiles';
import { Breadcrumbs } from '@/ui/catalog/Breadcrumbs';
import { EmptyState } from '@/ui/states';
import '@/ui/catalog/catalog.css';

export const metadata: Metadata = { title: 'Каталог товаров' };

export default async function CatalogIndexPage() {
  await connection(); // читает БД: не пререндерить на сборке
  const tree = await getCategoryTree();
  return (
    <>
      <Breadcrumbs items={[]} current="Каталог" />
      <h1>Каталог товаров</h1>
      {tree.length === 0 ? (
        <EmptyState title="Каталог пока пуст">
          <p>Товары появятся здесь после загрузки каталога.</p>
        </EmptyState>
      ) : (
        <CategoryTiles nodes={tree} label="Категории каталога" />
      )}
    </>
  );
}
