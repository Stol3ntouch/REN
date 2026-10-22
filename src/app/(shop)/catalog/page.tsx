import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { getCategoryTree } from '@/domain/catalog/categories';
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
        <ul className="category-cards">
          {tree.map((root) => (
            <li key={root.id} className="category-card">
              <h2 className="category-card__title">
                <Link href={`/catalog/${root.slug}`}>{root.name}</Link>
              </h2>
              <p className="category-card__count">{root.productCount} шт.</p>
              {root.children.length > 0 ? (
                <ul className="category-card__children">
                  {root.children.map((c) => (
                    <li key={c.id}>
                      <Link href={`/catalog/${c.slug}`}>{c.name}</Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
