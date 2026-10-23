import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { getPageByKey, pagePath, type PageKey } from '@/domain/content/queries';
import { contentMetadata } from '@/domain/content/seo';
import '@/ui/home/home.css';

export const metadata: Metadata = contentMetadata({
  title: 'Покупателям',
  fallbackDescription: 'Доставка и оплата, гарантия и возврат, вопросы и ответы, условия продажи.',
  path: '/buyers',
});

const KEYS: PageKey[] = ['delivery', 'warranty', 'faq', 'terms', 'privacy'];

/** Раздел «Покупателям»: ссылки на редактируемые страницы условий. */
export default async function BuyersPage() {
  await connection();
  const pages = KEYS.flatMap((k) => {
    const p = getPageByKey(k);
    return p ? [p] : [];
  });
  return (
    <>
      <h1>Покупателям</h1>
      <ul className="section-nav">
        {pages.map((p) => (
          <li key={p.id}>
            <Link href={pagePath(p)}>{p.title}</Link>
          </li>
        ))}
      </ul>
    </>
  );
}
