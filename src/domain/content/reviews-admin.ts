import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { reviewsRepo, type ReviewRow, type ReviewStatus } from '@/server/db/repositories/reviews';
import { NotFoundError, ValidationError } from '@/server/http/errors';
import { parse } from './ops-core';

/**
 * Отзывы о товарах в админке: список с фильтрами и страницами, модерация (опубликовать / отклонить / в ожидание),
 * ответ администратора. Право reviews.moderate проверяет каждая операция. Рейтинг товара считается только по опубликованным.
 */
type Opts = { db?: Db; now?: number };
type Session = StaffSession | null | undefined;

export const REVIEW_PAGE_SIZES = [10, 20, 50, 100] as const;

const filterSchema = z.object({
  status: z.enum(['pending', 'published', 'rejected']).optional(),
  productId: z.number().int().min(1).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  from: z.number().int().optional(),
  to: z.number().int().optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['created_desc', 'created_asc', 'rating_desc', 'rating_asc']).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});
export type ReviewListFilter = z.input<typeof filterSchema>;

const decisionSchema = z.enum(['pending', 'published', 'rejected'], { error: 'Неизвестное решение' });
const replySchema = z.string().trim().max(2000, 'Ответ — не длиннее 2000 символов');

export const reviewsModeration = {
  list(session: Session, filter: ReviewListFilter = {}, opts: Opts = {}): { rows: ReviewRow[]; total: number; page: number; pageSize: number; counts: Record<ReviewStatus, number> } {
    requirePermission(session, 'reviews.moderate');
    const db = opts.db ?? getDb();
    const f = parse(filterSchema, filter);
    const pageSize = f.pageSize ?? 20;
    const page = f.page ?? 1;
    const { rows, total } = reviewsRepo.search(db, { ...f, limit: pageSize, offset: (page - 1) * pageSize });
    return { rows, total, page, pageSize, counts: reviewsRepo.statusCounts(db) };
  },

  /** Решение по отзыву: опубликовать, отклонить или вернуть в ожидание. Аудит review.moderate. */
  moderate(session: Session, id: number, decision: unknown, opts: Opts = {}): ReviewRow {
    requirePermission(session, 'reviews.moderate');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const status = parse(decisionSchema, decision);
    return withTransaction(db, () => {
      const before = reviewsRepo.findById(db, id);
      if (!before) throw new NotFoundError('Отзыв не найден');
      reviewsRepo.setStatus(db, id, status, session.staffId, now);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'review.moderate', entity: 'review', entityId: id, before: { status: before.status }, after: { status, productId: before.productId } },
        { db, now },
      );
      return reviewsRepo.findById(db, id)!;
    });
  },

  /** Ответ администратора под отзывом; пустой текст убирает ответ. На витрине виден под опубликованным отзывом. */
  reply(session: Session, id: number, text: unknown, opts: Opts = {}): ReviewRow {
    requirePermission(session, 'reviews.moderate');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    if (typeof text !== 'string') throw new ValidationError('Введите текст ответа', { reply: ['Введите текст ответа'] });
    const reply = parse(replySchema, text);
    return withTransaction(db, () => {
      const before = reviewsRepo.findById(db, id);
      if (!before) throw new NotFoundError('Отзыв не найден');
      reviewsRepo.setReply(db, id, reply === '' ? null : reply, session.staffId, now);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'review.reply', entity: 'review', entityId: id, before: { hadReply: before.adminReply !== null }, after: { hasReply: reply !== '' } },
        { db, now },
      );
      return reviewsRepo.findById(db, id)!;
    });
  },
};
