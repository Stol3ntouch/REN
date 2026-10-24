import { getDb, type Db } from '@/server/db/connection';
import { reviewsRepo } from '@/server/db/repositories/reviews';

export type ProductRating = { average: number | null; count: number };
export type PublicReview = { id: number; authorName: string; rating: number; body: string; createdAt: number; adminReply: string | null; repliedAt: number | null };

/** Рейтинг товара — среднее по ОПУБЛИКОВАННЫМ отзывам, округлено до 0,1. Нет опубликованных → average=null (рейтинг не выводится). */
export function getProductRating(productId: number, opts: { db?: Db } = {}): ProductRating {
  const s = reviewsRepo.publishedStats(opts.db ?? getDb(), productId);
  return { count: s.count, average: s.average === null ? null : Math.round(s.average * 10) / 10 };
}

/** Опубликованные отзывы для витрины: только безопасные поля (без контактов и статусов). */
export function listPublishedReviews(productId: number, opts: { db?: Db } = {}): PublicReview[] {
  return reviewsRepo.listPublishedByProduct(opts.db ?? getDb(), productId).map((r) => ({ id: r.id, authorName: r.authorName, rating: r.rating, body: r.body, createdAt: r.createdAt, adminReply: r.adminReply, repliedAt: r.repliedAt }));
}
