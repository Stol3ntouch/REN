import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { connection } from 'next/server';
import { getPageBySlug, pagePath } from '@/domain/content/queries';
import { contentMetadata, plainExcerpt } from '@/domain/content/seo';
import { ContentPageView } from '@/ui/home/ContentPageView';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection();
  const page = getPageBySlug((await params).slug);
  if (!page) return { title: 'Страница не найдена', robots: { index: false } };
  return contentMetadata({ title: page.title, seoTitle: page.seoTitle, seoDescription: page.seoDescription, fallbackDescription: plainExcerpt(page.body), path: pagePath(page), canonical: page.canonical, noindex: page.noindex });
}

/** Редактируемые страницы: доставка и оплата, гарантия и возврат, вопросы и ответы, условия продажи. */
export default async function ContentPage({ params }: Props) {
  await connection();
  const page = getPageBySlug((await params).slug);
  if (!page) notFound();
  const canonical = pagePath(page);
  if (!canonical.startsWith('/pages/')) permanentRedirect(canonical); // «О компании» и политика живут по своим адресам
  return <ContentPageView page={page} />;
}
