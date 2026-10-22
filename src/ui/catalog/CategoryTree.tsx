import Link from 'next/link';
import type { CategoryNode } from '@/domain/catalog/types';

/** Дерево категорий: ветка с текущей категорией раскрыта. Работает без JS (<details>). */
export function CategoryTree({ tree, activeSlug }: { tree: CategoryNode[]; activeSlug?: string }) {
  const hasActive = (n: CategoryNode): boolean => n.slug === activeSlug || n.children.some(hasActive);
  const link = (n: CategoryNode) => (
    <Link href={`/catalog/${n.slug}`} aria-current={n.slug === activeSlug ? 'page' : undefined}>
      {n.name}
    </Link>
  );
  return (
    <nav className="category-tree" aria-label="Категории">
      <ul>
        {tree.map((root) => (
          <li key={root.id}>
            {root.children.length > 0 ? (
              <details open={hasActive(root)}>
                <summary>
                  {link(root)}
                  <span className="category-tree__count">{root.productCount}</span>
                </summary>
                <ul>
                  {root.children.map((c) => (
                    <li key={c.id}>
                      {link(c)}
                      <span className="category-tree__count">{c.productCount}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <div className="category-tree__leaf">
                {link(root)}
                <span className="category-tree__count">{root.productCount}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
