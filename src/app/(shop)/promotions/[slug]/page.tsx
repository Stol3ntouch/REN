import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getPublishedPromotion, isPromotionActiveNow } from '@/domain/content/queries';
import { contentMetadata, plainExcerpt } from '@/domain/content/seo';
import { formatRub } from '@/domain/pricing/format';
import { promotionPrice } from '@/domain/pricing/promotion-rules';
import { getDb } from '@/server/db/connection';
import { promotionsRepo } from '@/server/db/repositories/promotions';
import { formatDate } from '@/ui/home/format';
import { RichText } from '@/ui/home/RichText';
import '@/ui/home/home.css';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection();
  const item = getPublishedPromotion((await params).slug);
  if (!item) return { title: 'Акция не найдена', robots: { index: false } };
  return contentMetadata({
    title: item.title,
    seoTitle: item.seoTitle,
    seoDescription: item.seoDescription,
    fallbackDescription: item.summary ?? plainExcerpt(item.body),
    path: `/promotions/${item.slug}`,
    image: item.image,
  });
}

export default async function PromotionPage({ params }: Props) {
  await connection();
  const item = getPublishedPromotion((await params).slug);
  if (!item) notFound();
  const active = isPromotionActiveNow(item);
  const products = active && item.discountType !== 'none' ? promotionsRepo.participatingProducts(getDb(), promotionsRepo.targets(getDb(), item.id), 24, 0) : [];
  return (
    <article className="content-article">
      <h1>{item.h1 || item.title}</h1>
      <p className="content-meta">
        {!active
          ? 'Акция завершена или ещё не началась.'
          : item.endsAt
            ? `Действует до ${formatDate(item.endsAt)}`
            : item.startsAt
              ? `Действует с ${formatDate(item.startsAt)}`
              : 'Действует сейчас'}
      </p>
      {item.image ? (
        <figure className="content-figure">
          {/* eslint-disable-next-line @next/next/no-img-element -- локальный WebP из каталога загрузок */}
          <img src={item.image.src} alt={item.image.alt} width={item.image.width} height={item.image.height} decoding="async" />
        </figure>
      ) : null}
      {item.summary ? <p>{item.summary}</p> : null}
      <RichText text={item.body} />
      {item.conditions ? (
        <section aria-labelledby="promo-conditions">
          <h2 id="promo-conditions">Условия акции</h2>
          <p>{item.conditions}</p>
        </section>
      ) : null}
      {active && item.discountType !== 'none' && products.length > 0 ? (
        <section aria-labelledby="promo-products">
          <h2 id="promo-products">Товары по акции</h2>
          {item.minSubtotalKopecks > 0 ? <p>Акция действует, если сумма товаров в корзине от {formatRub(item.minSubtotalKopecks)}.</p> : null}
          <ul className="promo-products">
            {products.map((p) => {
              const price = promotionPrice(p.priceKopecks, item);
              return (
                <li key={p.id}>
                  <Link href={`/product/${p.slug}`}>{p.name}</Link>{' '}
                  {price !== null ? (
                    <>
                      <s>{formatRub(p.priceKopecks)}</s> <strong>{formatRub(price)}</strong>
                    </>
                  ) : (
                    formatRub(p.priceKopecks)
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {active && item.promoCode ? (
        <div className="promo-code-box">
          <span>Промокод</span>
          <code>{item.promoCode}</code>
          <Link href="/cart#promo-code">Ввести в корзине</Link>
        </div>
      ) : null}
      <p>
        <Link href="/promotions">← Все акции</Link>
      </p>
    </article>
  );
}
