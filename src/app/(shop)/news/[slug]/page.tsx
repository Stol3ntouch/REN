import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getPublishedNews } from '@/domain/content/queries';
import { contentMetadata, plainExcerpt } from '@/domain/content/seo';
import { formatDate, isoDate } from '@/ui/home/format';
import { RichText } from '@/ui/home/RichText';
import '@/ui/home/home.css';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection();
  const item = getPublishedNews((await params).slug);
  if (!item) return { title: 'Новость не найдена', robots: { index: false } };
  return contentMetadata({
    title: item.title,
    seoTitle: item.seoTitle,
    seoDescription: item.seoDescription,
    fallbackDescription: item.excerpt ?? plainExcerpt(item.body),
    path: `/news/${item.slug}`,
    canonical: item.canonical,
    noindex: item.noindex,
    image: item.image,
    type: 'article',
  });
}

export default async function NewsArticlePage({ params }: Props) {
  await connection();
  const item = getPublishedNews((await params).slug);
  if (!item) notFound();
  const date = item.publishedAt ?? item.updatedAt;
  return (
    <article className="content-article">
      <h1>{item.h1 || item.title}</h1>
      <p className="content-meta">
        <time dateTime={isoDate(date)}>{formatDate(date)}</time>
        {item.authorName ? <> · <span>Автор: {item.authorName}</span></> : null}
      </p>
      {item.image ? (
        <figure className="content-figure">
          {/* eslint-disable-next-line @next/next/no-img-element -- локальный WebP из каталога загрузок */}
          <img src={item.image.src} alt={item.image.alt} width={item.image.width} height={item.image.height} decoding="async" />
        </figure>
      ) : null}
      <RichText text={item.body} />
      <p>
        <Link href="/news">← Все новости</Link>
      </p>
    </article>
  );
}
