import Link from 'next/link';
import { getCategoryImages } from '@/domain/catalog/category-images';
import { pluralize } from '@/domain/catalog/format';
import type { CategoryNode } from '@/domain/catalog/types';
import { ProductImage } from './ProductImage';

/** Плитки категорий с фото (первый товар категории); нет фото или оно не загрузилось — нейтральная иконка. */
export function CategoryTiles({ nodes, label }: { nodes: CategoryNode[]; label?: string }) {
  const images = getCategoryImages(nodes.map((n) => n.id), { size: 'card' });
  return (
    <ul className="category-tiles" aria-label={label}>
      {nodes.map((n, i) => {
        const image = images.get(n.id) ?? null;
        return (
          <li key={n.id}>
            <Link href={`/catalog/${n.slug}`} className="category-tile">
              <span className="category-tile__media">
                <ProductImage image={image ? { ...image, alt: '' } : null} name="" priority={i < 4} sizes="(min-width: 64rem) 16rem, 50vw" />
              </span>
              <span className="category-tile__name">{n.name}</span>
              <span className="category-tile__count">
                {n.productCount} {pluralize(n.productCount, ['товар', 'товара', 'товаров'])}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
