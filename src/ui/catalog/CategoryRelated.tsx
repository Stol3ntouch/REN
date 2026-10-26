import Link from 'next/link';
import type { RelatedRow } from '@/server/db/repositories/category-links';

/** «Смотрите также»: связанные категории, выбранные в админке (C06). Нет связей или все скрыты — блока нет. */
export function CategoryRelated({ items }: { items: Pick<RelatedRow, 'id' | 'name' | 'slug'>[] }) {
  if (items.length === 0) return null;
  return (
    <section className="category-related" aria-labelledby="category-related-title">
      <h2 id="category-related-title">Смотрите также</h2>
      <ul className="category-related__list">
        {items.map((c) => (
          <li key={c.id}>
            <Link href={`/catalog/${c.slug}`}>{c.name}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
