import Link from 'next/link';
import { getCategoryImages } from '@/domain/catalog/category-images';
import { pluralize } from '@/domain/catalog/format';
import type { CategoryNode } from '@/domain/catalog/types';

/** Плитки категорий с фото (первый товар категории); нет фото — нейтральная плитка с иконкой. */
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
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- внешние и локальные фото, хосты не настроены для next/image
                  <img
                    src={image.src}
                    alt={image.alt}
                    width={image.width ?? 480}
                    height={image.height ?? 360}
                    loading={i < 4 ? 'eager' : 'lazy'}
                    decoding="async"
                    referrerPolicy={image.remote ? 'no-referrer' : undefined}
                  />
                ) : (
                  <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true" focusable="false">
                    <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" d="M3 7.5l9-4.5 9 4.5v9l-9 4.5-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9" />
                  </svg>
                )}
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
