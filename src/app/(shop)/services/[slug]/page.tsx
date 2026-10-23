import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getPublishedService } from '@/domain/content/queries';
import { contentMetadata, plainExcerpt } from '@/domain/content/seo';
import { getShopInfo } from '@/domain/content/settings';
import { RichText } from '@/ui/home/RichText';
import '@/ui/home/home.css';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection();
  const item = getPublishedService((await params).slug);
  if (!item) return { title: 'Услуга не найдена', robots: { index: false } };
  return contentMetadata({
    title: item.title,
    seoTitle: item.seoTitle,
    seoDescription: item.seoDescription,
    fallbackDescription: item.summary ?? plainExcerpt(item.body),
    path: `/services/${item.slug}`,
    image: item.image,
  });
}

export default async function ServicePage({ params }: Props) {
  await connection();
  const item = getPublishedService((await params).slug);
  if (!item) notFound();
  const shop = getShopInfo();
  return (
    <article className="content-article">
      <h1>{item.h1 || item.title}</h1>
      {item.priceText ? <p className="content-meta">{item.priceText}</p> : null}
      {item.image ? (
        <figure className="content-figure">
          {/* eslint-disable-next-line @next/next/no-img-element -- локальный WebP из каталога загрузок */}
          <img src={item.image.src} alt={item.image.alt} width={item.image.width} height={item.image.height} decoding="async" />
        </figure>
      ) : null}
      {item.summary ? <p>{item.summary}</p> : null}
      <RichText text={item.body} />
      {/* Якорь для формы заявки на ремонт (T09 вставляет форму сюда). */}
      <section id="repair-form" className="anchor-slot" aria-labelledby="repair-form-title">
        <h2 id="repair-form-title">Заявка на ремонт</h2>
        <p>
          Форма заявки скоро появится на этой странице.
          {shop.phone ? (
            <>
              {' '}
              А пока позвоните: <a href={shop.phoneHref ?? undefined}>{shop.phone}</a>.
            </>
          ) : null}
        </p>
      </section>
      <p>
        <Link href="/services">← Все услуги</Link>
      </p>
    </article>
  );
}
