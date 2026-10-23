import Link from 'next/link';
import type { CatalogImage } from '@/domain/catalog/types';
import type { CompanyReviewRow } from '@/server/db/repositories/company-reviews';
import type { NewsRow } from '@/server/db/repositories/news';
import type { PromotionRow } from '@/server/db/repositories/promotions';
import type { ServiceRow } from '@/server/db/repositories/services';
import { formatDate, isoDate } from './format';

type WithImage<T> = T & { image: CatalogImage | null };

function CardImage({ image }: { image: CatalogImage | null }) {
  if (!image) return null;
  return (
    <span className="info-card__media">
      {/* eslint-disable-next-line @next/next/no-img-element -- локальные WebP разных размеров из каталога загрузок */}
      <img src={image.src} alt={image.alt} width={image.width ?? 480} height={image.height ?? 270} loading="lazy" decoding="async" />
    </span>
  );
}

export function NewsCard({ item }: { item: WithImage<NewsRow> }) {
  const date = item.publishedAt ?? item.updatedAt;
  return (
    <article className="info-card">
      <Link className="info-card__link" href={`/news/${item.slug}`}>
        <CardImage image={item.image} />
        <span className="info-card__body">
          <time className="info-card__meta" dateTime={isoDate(date)}>
            {formatDate(date)}
          </time>
          <span className="info-card__title">{item.title}</span>
          {item.excerpt ? <span className="info-card__text">{item.excerpt}</span> : null}
        </span>
      </Link>
    </article>
  );
}

export function PromotionCard({ item }: { item: WithImage<PromotionRow> }) {
  return (
    <article className="info-card">
      <Link className="info-card__link" href={`/promotions/${item.slug}`}>
        <CardImage image={item.image} />
        <span className="info-card__body">
          {item.endsAt ? <span className="info-card__meta">до {formatDate(item.endsAt)}</span> : null}
          <span className="info-card__title">{item.title}</span>
          {item.summary ? <span className="info-card__text">{item.summary}</span> : null}
        </span>
      </Link>
    </article>
  );
}

export function ServiceCard({ item }: { item: WithImage<ServiceRow> }) {
  return (
    <article className="info-card">
      <Link className="info-card__link" href={`/services/${item.slug}`}>
        <CardImage image={item.image} />
        <span className="info-card__body">
          <span className="info-card__title">{item.title}</span>
          {item.summary ? <span className="info-card__text">{item.summary}</span> : null}
          {item.priceText ? <span className="info-card__meta">{item.priceText}</span> : null}
        </span>
      </Link>
    </article>
  );
}

/** Отзыв о компании. Оценка показывается только если её ввёл админ; среднего рейтинга нет. */
export function ReviewCard({ item }: { item: CompanyReviewRow }) {
  return (
    <figure className="review-card">
      <figcaption className="review-card__head">
        <span className="review-card__avatar" aria-hidden="true">
          {item.authorName.trim().charAt(0).toUpperCase()}
        </span>
        <span className="review-card__author">{item.authorName}</span>
        {item.reviewedAt ? <span className="info-card__meta">{formatDate(item.reviewedAt)}</span> : null}
        {item.rating ? (
          <span className="review-card__rating" role="img" aria-label={`Оценка: ${item.rating} из 5`}>
            {'★'.repeat(item.rating)}
            <span className="review-card__rating-off" aria-hidden="true">
              {'★'.repeat(5 - item.rating)}
            </span>
          </span>
        ) : null}
      </figcaption>
      <blockquote className="review-card__text">{item.body}</blockquote>
    </figure>
  );
}
