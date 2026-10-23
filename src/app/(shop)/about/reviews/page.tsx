import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { listPublishedReviews } from '@/domain/content/queries';
import { contentMetadata } from '@/domain/content/seo';
import { ReviewCard } from '@/ui/home/cards';
import '@/ui/home/home.css';

export const metadata: Metadata = contentMetadata({
  title: 'Отзывы о компании',
  fallbackDescription: 'Отзывы о магазине «РемТехСад».',
  path: '/about/reviews',
});

/** Раздел скрыт, пока нет опубликованных отзывов (их вносит и публикует администратор). */
export default async function CompanyReviewsPage() {
  await connection();
  const reviews = listPublishedReviews();
  if (reviews.length === 0) notFound();
  return (
    <>
      <h1>Отзывы о компании</h1>
      <ul className="info-grid">
        {reviews.map((r) => (
          <li key={r.id}>
            <ReviewCard item={r} />
          </li>
        ))}
      </ul>
    </>
  );
}
