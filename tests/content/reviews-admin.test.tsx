import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { reviewsModeration } from '@/domain/content/reviews-admin';
import { getProductRating, listPublishedReviews } from '@/domain/requests/public';
import { auditRepo } from '@/server/db/repositories/audit';
import { reviewsRepo } from '@/server/db/repositories/reviews';
import { createTestDb } from '@/server/db/testing';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { ProductFeedback } from '@/ui/forms/ProductFeedback';
import { ADMIN, MANAGER, T0, insertProduct } from './helpers';

const DAY = 86_400_000;
type Db = ReturnType<typeof createTestDb>;
const ctx = (db: Db, now = T0) => ({ db, now });

function seed(db: Db) {
  const p1 = insertProduct(db, { n: 1 });
  const p2 = insertProduct(db, { n: 2 });
  const add = (productId: number, rating: number, author: string, body: string, at: number) => reviewsRepo.insert(db, { productId, rating, authorName: author, body, now: at });
  return {
    p1,
    p2,
    a: add(p1, 5, 'Анна', 'Отличная косилка', T0 - 3 * DAY),
    b: add(p1, 2, 'Борис', 'Сломалась', T0 - 2 * DAY),
    c: add(p2, 4, 'Вера', 'Хороший триммер', T0 - DAY),
  };
}

describe('отзывы: список, фильтры, страницы', () => {
  it('фильтры статус / товар / оценка / период / поиск и серверная пагинация с сортировкой', () => {
    const db = createTestDb();
    const s = seed(db);
    reviewsModeration.moderate(ADMIN, s.a, 'published', ctx(db));
    const list = (f: object) => reviewsModeration.list(ADMIN, f, ctx(db));
    expect(list({}).total).toBe(3);
    expect(list({}).counts).toEqual({ pending: 2, published: 1, rejected: 0 });
    expect(list({ status: 'published' }).rows.map((r) => r.authorName)).toEqual(['Анна']);
    expect(list({ productId: s.p2 }).rows.map((r) => r.authorName)).toEqual(['Вера']);
    expect(list({ rating: 2 }).rows.map((r) => r.authorName)).toEqual(['Борис']);
    expect(list({ from: T0 - 2 * DAY - 1, to: T0 - DAY + 1 }).rows.map((r) => r.authorName)).toEqual(['Вера', 'Борис']);
    expect(list({ q: 'ТРИММЕР' }).rows.map((r) => r.authorName)).toEqual(['Вера']);
    expect(list({ sort: 'rating_desc' }).rows.map((r) => r.rating)).toEqual([5, 4, 2]);
    const page2 = list({ pageSize: 2, page: 2, sort: 'created_asc' });
    expect(page2.rows.map((r) => r.authorName)).toEqual(['Вера']);
    expect(page2.total).toBe(3);
    expect(() => list({ rating: 9 })).toThrow(ValidationError);
  });
});

describe('отзывы: модерация и ответ', () => {
  it('опубликовать, отклонить, вернуть в ожидание; рейтинг только по опубликованным; аудит', () => {
    const db = createTestDb();
    const s = seed(db);
    expect(getProductRating(s.p1, { db })).toEqual({ average: null, count: 0 });
    reviewsModeration.moderate(ADMIN, s.a, 'published', ctx(db));
    reviewsModeration.moderate(ADMIN, s.b, 'rejected', ctx(db));
    expect(getProductRating(s.p1, { db })).toEqual({ average: 5, count: 1 });
    reviewsModeration.moderate(ADMIN, s.b, 'published', ctx(db));
    expect(getProductRating(s.p1, { db })).toEqual({ average: 3.5, count: 2 });
    reviewsModeration.moderate(ADMIN, s.a, 'pending', ctx(db));
    expect(listPublishedReviews(s.p1, { db }).map((r) => r.authorName)).toEqual(['Борис']);
    expect(getProductRating(s.p1, { db })).toEqual({ average: 2, count: 1 });
    expect(auditRepo.list(db, { entity: 'review' }).map((a) => a.action)).toEqual(Array(4).fill('review.moderate'));
    expect(() => reviewsModeration.moderate(ADMIN, s.a, 'deleted', ctx(db))).toThrow(ValidationError);
    expect(() => reviewsModeration.moderate(ADMIN, 99_999, 'published', ctx(db))).toThrow(NotFoundError);
  });

  it('ответ администратора: сохраняется с автором и временем, виден на витрине под опубликованным отзывом, пустой текст убирает', () => {
    const db = createTestDb();
    const s = seed(db);
    reviewsModeration.moderate(ADMIN, s.a, 'published', ctx(db));
    reviewsModeration.reply(ADMIN, s.a, '  Спасибо за отзыв!  ', ctx(db, T0 + 5));
    expect(reviewsRepo.findById(db, s.a)).toMatchObject({ adminReply: 'Спасибо за отзыв!', repliedAt: T0 + 5, repliedBy: ADMIN.staffId });
    expect(listPublishedReviews(s.p1, { db })[0]).toMatchObject({ adminReply: 'Спасибо за отзыв!', repliedAt: T0 + 5 });
    // компонент витрины читает общее соединение: подставляем тестовую БД на время рендера
    const holder = globalThis as unknown as { __rtsDb?: Db };
    const prev = holder.__rtsDb;
    holder.__rtsDb = db;
    let html = '';
    try {
      html = renderToStaticMarkup(<ProductFeedback productId={s.p1} />);
    } finally {
      holder.__rtsDb = prev;
    }
    expect(html).toContain('Ответ магазина');
    expect(html).toContain('Спасибо за отзыв!');

    // ответ неопубликованному отзыву сохраняется, но публике не виден
    reviewsModeration.reply(ADMIN, s.c, 'Ответ в черновик', ctx(db));
    expect(listPublishedReviews(s.p2, { db })).toEqual([]);

    reviewsModeration.reply(ADMIN, s.a, '   ', ctx(db));
    expect(reviewsRepo.findById(db, s.a)).toMatchObject({ adminReply: null, repliedAt: null, repliedBy: null });
    expect(() => reviewsModeration.reply(ADMIN, s.a, 'x'.repeat(2001), ctx(db))).toThrow(ValidationError);
    expect(() => reviewsModeration.reply(ADMIN, 99_999, 'x', ctx(db))).toThrow(NotFoundError);
    expect(auditRepo.list(db, { entity: 'review' }).filter((a) => a.action === 'review.reply')).toHaveLength(3);
  });

  it('права reviews.moderate проверяются в самих операциях: без сессии — 401, без права — 403', () => {
    const db = createTestDb();
    const s = seed(db);
    const nobody = { ...MANAGER, role: 'nobody-role' };
    expect(() => reviewsModeration.list(null, {}, ctx(db))).toThrow(UnauthorizedError);
    expect(() => reviewsModeration.moderate(null, s.a, 'published', ctx(db))).toThrow(UnauthorizedError);
    expect(() => reviewsModeration.reply(nobody, s.a, 'x', ctx(db))).toThrow(ForbiddenError);
    expect(() => reviewsModeration.moderate(nobody, s.a, 'published', ctx(db))).toThrow(ForbiddenError);
    expect(reviewsRepo.findById(db, s.a)?.status).toBe('pending');
  });
});
