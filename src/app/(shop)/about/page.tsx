import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getPageByKey, pagePath } from '@/domain/content/queries';
import { contentMetadata, plainExcerpt } from '@/domain/content/seo';
import { ContentPageView } from '@/ui/home/ContentPageView';
import { companyReviewsRepo } from '@/server/db/repositories/company-reviews';
import { getDb } from '@/server/db/connection';

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const page = getPageByKey('about');
  if (!page) return { title: 'О компании' };
  return contentMetadata({ title: page.title, seoTitle: page.seoTitle, seoDescription: page.seoDescription, fallbackDescription: plainExcerpt(page.body), path: pagePath(page) });
}

export default async function AboutPage() {
  await connection();
  const page = getPageByKey('about');
  if (!page) notFound();
  const hasReviews = companyReviewsRepo.count(getDb(), 'published = 1') > 0;
  return (
    <>
      <ContentPageView page={page} />
      {hasReviews ? (
        <p>
          <Link href="/about/reviews">Отзывы о компании</Link>
        </p>
      ) : null}
    </>
  );
}
