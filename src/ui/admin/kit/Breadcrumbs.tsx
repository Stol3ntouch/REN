import Link from 'next/link';
import { Fragment } from 'react';
import { Icon } from './icons';

export type BreadcrumbItem = { label: string; href?: string };

/** Хлебные крошки: последняя — текущая страница (aria-current), без ссылки. */
export function Breadcrumbs({ items }: { items: readonly BreadcrumbItem[] }) {
  if (items.length === 0) return null;
  return (
    <nav className="ak-crumbs" aria-label="Хлебные крошки">
      <ol>
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={`${i}-${item.label}`}>
              <li>
                {last || !item.href ? (
                  <span aria-current={last ? 'page' : undefined}>{item.label}</span>
                ) : (
                  <Link href={item.href} prefetch={false}>
                    {item.label}
                  </Link>
                )}
              </li>
              {last ? null : (
                <li className="ak-crumbs__sep" aria-hidden="true">
                  <Icon name="chevron-right" size={14} />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
