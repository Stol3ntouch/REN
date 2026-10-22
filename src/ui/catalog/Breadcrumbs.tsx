import Link from 'next/link';
import type { Breadcrumb } from '@/domain/catalog/types';

/** Хлебные крошки; последний пункт без ссылки — текущая страница. */
export function Breadcrumbs({ items, current }: { items: Breadcrumb[]; current?: string }) {
  const all: { name: string; href?: string }[] = [{ name: 'Главная', href: '/' }, ...items];
  if (current) all.push({ name: current });
  return (
    <nav className="breadcrumbs" aria-label="Хлебные крошки">
      <ol>
        {all.map((c, i) => {
          const last = i === all.length - 1;
          return (
            <li key={`${c.name}-${i}`}>
              {c.href && !last ? <Link href={c.href}>{c.name}</Link> : <span aria-current={last ? 'page' : undefined}>{c.name}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
