import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getPageByKey, pagePath } from '@/domain/content/queries';
import { contentMetadata, plainExcerpt } from '@/domain/content/seo';
import { ContentPageView } from '@/ui/home/ContentPageView';

/** Политика обработки персональных данных: адрес /privacy фиксирован (на него ссылаются согласия в формах). */
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const page = getPageByKey('privacy');
  if (!page) return { title: 'Политика обработки персональных данных' };
  return contentMetadata({ title: page.title, seoTitle: page.seoTitle, seoDescription: page.seoDescription, fallbackDescription: plainExcerpt(page.body), path: pagePath(page), canonical: page.canonical, noindex: page.noindex });
}

export default async function PrivacyPage() {
  await connection();
  const page = getPageByKey('privacy');
  if (!page) notFound();
  return <ContentPageView page={page} />;
}
