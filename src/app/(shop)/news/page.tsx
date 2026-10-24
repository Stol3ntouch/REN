import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { countPublishedNews, getNewsCategoryBySlug, listNewsCategories, listPublishedNews } from '@/domain/content/queries';
import { contentMetadata } from '@/domain/content/seo';
import { NewsCard } from '@/ui/home/cards';
import '@/ui/home/home.css';

export const metadata: Metadata = contentMetadata({ title: 'Новости', fallbackDescription: 'Новости магазина «РемТехСад».', path: '/news' });

const PAGE_SIZE = 12;

const href = (category: string | null, page: number): string => {
  const q = new URLSearchParams();
  if (category) q.set('category', category);
  if (page > 1) q.set('page', String(page));
  const s = q.toString();
  return s ? `/news?${s}` : '/news';
};

/** Раздел скрыт, пока нет опубликованных новостей. Фильтр по категории и страницы — в адресе (?category=&page=). */
export default async function NewsListPage({ searchParams }: { searchParams: Promise<{ page?: string; category?: string }> }) {
  await connection();
  const sp = await searchParams;
  if (countPublishedNews() === 0) notFound();
  const categories = listNewsCategories();
  const category = sp.category ? getNewsCategoryBySlug(sp.category) : null;
  if (sp.category && !category) notFound();
  const categoryId = category?.id ?? null;
  const total = countPublishedNews({ categoryId });
  const raw = Number(sp.page ?? '1');
  const page = Number.isInteger(raw) && raw >= 1 ? raw : 1;
  const items = listPublishedNews({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, categoryId });
  if (items.length === 0 && !(page === 1 && category)) notFound();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <>
      <h1>{category ? `Новости: ${category.name}` : 'Новости'}</h1>
      {categories.length > 0 ? (
        <nav className="pager" aria-label="Категории новостей">
          <Link href="/news" aria-current={category ? undefined : 'page'}>
            Все
          </Link>
          {categories.map((c) => (
            <Link key={c.id} href={href(c.slug, 1)} aria-current={category?.id === c.id ? 'page' : undefined}>
              {c.name} ({c.count})
            </Link>
          ))}
        </nav>
      ) : null}
      <ul className="info-grid">
        {items.map((n) => (
          <li key={n.id}>
            <NewsCard item={n} />
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <nav className="pager" aria-label="Страницы новостей">
          {page > 1 ? <Link href={href(category?.slug ?? null, page - 1)}>← Новее</Link> : null}
          <span>
            Страница {page} из {pages}
          </span>
          {page < pages ? <Link href={href(category?.slug ?? null, page + 1)}>Старее →</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
