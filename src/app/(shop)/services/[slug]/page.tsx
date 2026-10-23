import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getPublishedService } from '@/domain/content/queries';
import { contentMetadata, plainExcerpt } from '@/domain/content/seo';
import { RichText } from '@/ui/home/RichText';
import { RepairForm } from '@/ui/forms/forms';
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
      <section id="repair-form" className="form-section" aria-labelledby="repair-form-title">
        <h2 id="repair-form-title">Заявка на ремонт</h2>
        <RepairForm />
      </section>
      <p>
        <Link href="/services">← Все услуги</Link>
      </p>
    </article>
  );
}
