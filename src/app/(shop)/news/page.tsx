import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { countPublishedNews, listPublishedNews } from '@/domain/content/queries';
import { contentMetadata } from '@/domain/content/seo';
import { NewsCard } from '@/ui/home/cards';
import '@/ui/home/home.css';

export const metadata: Metadata = contentMetadata({ title: 'Новости', fallbackDescription: 'Новости магазина «РемТехСад».', path: '/news' });

const PAGE_SIZE = 12;

/** Раздел скрыт, пока нет опубликованных новостей. */
export default async function NewsListPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await connection();
  const total = countPublishedNews();
  if (total === 0) notFound();
  const raw = Number((await searchParams).page ?? '1');
  const page = Number.isInteger(raw) && raw >= 1 ? raw : 1;
  const items = listPublishedNews({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  if (items.length === 0) notFound();
  const pages = Math.ceil(total / PAGE_SIZE);
  return (
    <>
      <h1>Новости</h1>
      <ul className="info-grid">
        {items.map((n) => (
          <li key={n.id}>
            <NewsCard item={n} />
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <nav className="pager" aria-label="Страницы новостей">
          {page > 1 ? <Link href={page === 2 ? '/news' : `/news?page=${page - 1}`}>← Новее</Link> : null}
          <span>
            Страница {page} из {pages}
          </span>
          {page < pages ? <Link href={`/news?page=${page + 1}`}>Старее →</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
