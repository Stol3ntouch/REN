import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import { newRequests } from '@/domain/analytics';
import { requestsAdmin, reviewsAdmin } from '@/domain/requests/admin-ops';
import { getProductRating, listPublishedReviews } from '@/domain/requests/public';
import { submitRepair, submitReview } from '@/domain/requests/service';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { admin, manager } from '../admin/helpers';
import { addCategory, addProduct, createTestDb } from '../catalog/helpers';

const T0 = Date.UTC(2026, 9, 22, 12);

function setup() {
  const db = createTestDb();
  const productId = addProduct(db, { name: 'Триммер', slug: 'trimmer', categoryId: addCategory(db, 'Триммеры', 'trimmery') });
  let n = 0;
  const ctx = () => ({ db, now: T0 + n, ip: `10.0.${(n += 1)}.1`, owner: null });
  const review = async (rating: number, over: Record<string, unknown> = {}) =>
    (await submitReview({ productId, rating, authorName: 'Мария', body: 'Хороший товар, пользуюсь месяц', consent: true, website: '', ...over }, ctx())).id!;
  const repair = async () =>
    (await submitRepair({ name: 'Иван', phone: '+7 916 123-45-67', email: 'ivan@example.com', equipmentType: 'Пила', description: 'Не заводится совсем', preferredContact: 'phone', consent: true }, ctx())).id!;
  return { db, productId, review, repair };
}

describe('обработка заявок в админке', () => {
  it('manager и admin видят заявки, меняют статус и пишут заметку; изменение попадает в аудит с замаскированными контактами', async () => {
    const { db, repair } = setup();
    const id = await repair();
    for (const [who, status] of [[manager, 'in_work'], [admin, 'done']] as const) {
      const row = requestsAdmin.update(who, id, { status, note: 'Позвонил, клиент ждёт: ivan@example.com' }, { db, now: T0 + 1000 });
      expect(row.status).toBe(status);
    }
    expect(requestsAdmin.list(manager, { kind: 'repair' }, { db })[0]).toMatchObject({ status: 'done', note: 'Позвонил, клиент ждёт: ivan@example.com' });
    const log = audit.list({ entity: 'request' }, { db });
    expect(log).toHaveLength(2);
    expect(JSON.stringify(log)).not.toContain('ivan@example.com');
  });

  it('без сессии — 401, неизвестный статус — ошибка валидации, чужой номер — 404', async () => {
    const { db, repair } = setup();
    const id = await repair();
    expect(() => requestsAdmin.update(null, id, { status: 'done' }, { db })).toThrow(UnauthorizedError);
    expect(() => requestsAdmin.list(null, {}, { db })).toThrow(UnauthorizedError);
    expect(() => requestsAdmin.update(manager, id, { status: 'archived' }, { db })).toThrow(ValidationError);
    expect(() => requestsAdmin.update(manager, 9999, { status: 'done' }, { db })).toThrow(NotFoundError);
  });

  it('аналитика T10 видит новые заявки и отзывы на модерации по таблицам requests/reviews', async () => {
    const { db, repair, review } = setup();
    await repair();
    await review(5);
    expect(newRequests(db)).toMatchObject({ available: true, repair: 1, reviewsPending: 1 });
    const id = (await repair()) as number;
    requestsAdmin.update(manager, id, { status: 'in_work' }, { db });
    expect(newRequests(db).repair).toBe(1);
  });
});

describe('модерация отзывов и рейтинг', () => {
  it('отзыв pending не виден публично; после одобрения виден', async () => {
    const { db, productId, review } = setup();
    const id = await review(5);
    expect(listPublishedReviews(productId, { db })).toEqual([]);
    const row = reviewsAdmin.moderate(manager, id, 'published', { db, now: T0 + 5 });
    expect(row.status).toBe('published');
    expect(listPublishedReviews(productId, { db }).map((r) => r.body)).toEqual(['Хороший товар, пользуюсь месяц']);
    expect(Object.keys(listPublishedReviews(productId, { db })[0]!).sort()).toEqual(['authorName', 'body', 'createdAt', 'id', 'rating']);
  });

  it('рейтинг — среднее только по опубликованным; без опубликованных рейтинга нет', async () => {
    const { db, productId, review } = setup();
    const a = await review(5);
    const b = await review(1);
    const c = await review(4);
    expect(getProductRating(productId, { db })).toEqual({ average: null, count: 0 });
    reviewsAdmin.moderate(manager, a, 'published', { db });
    reviewsAdmin.moderate(admin, c, 'published', { db });
    reviewsAdmin.moderate(admin, b, 'rejected', { db });
    expect(getProductRating(productId, { db })).toEqual({ average: 4.5, count: 2 });
    reviewsAdmin.moderate(manager, a, 'rejected', { db });
    expect(getProductRating(productId, { db })).toEqual({ average: 4, count: 1 });
    reviewsAdmin.moderate(manager, c, 'rejected', { db });
    expect(getProductRating(productId, { db })).toEqual({ average: null, count: 0 });
  });

  it('модерация пишется в аудит; без сессии 401, неверное решение — ошибка, неизвестный отзыв — 404', async () => {
    const { db, review } = setup();
    const id = await review(3);
    expect(() => reviewsAdmin.moderate(null, id, 'published', { db })).toThrow(UnauthorizedError);
    expect(() => reviewsAdmin.moderate(manager, id, 'pending', { db })).toThrow(ValidationError);
    expect(() => reviewsAdmin.moderate(manager, 9999, 'published', { db })).toThrow(NotFoundError);
    reviewsAdmin.moderate(manager, id, 'published', { db });
    expect(audit.list({ action: 'review.moderate' }, { db })).toHaveLength(1);
    expect(audit.list({ action: 'review.moderate' }, { db })[0]).toMatchObject({ entity: 'review', entityId: String(id) });
  });

  it('права: другая роль без права модерации получает отказ', async () => {
    const { db, review } = setup();
    const id = await review(3);
    const stranger = { staffId: 9, email: 'x@shop.test', name: null, role: 'viewer' } as unknown as typeof manager;
    expect(() => reviewsAdmin.moderate(stranger, id, 'published', { db })).toThrow(ForbiddenError);
    expect(() => requestsAdmin.list(stranger, {}, { db })).toThrow(ForbiddenError);
  });
});

describe('нет выдуманного содержимого', () => {
  it('после миграций нет отзывов и заявок; миграции, сид и фикстуры не вставляют их', () => {
    const db = createTestDb();
    for (const t of ['reviews', 'requests', 'email_outbox']) expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, t).toBe(0);
    const root = process.cwd();
    const files = [
      ...readdirSync(join(root, 'migrations')).map((f) => join(root, 'migrations', f)),
      ...readdirSync(join(root, 'scripts', 'seed')).map((f) => join(root, 'scripts', 'seed', f)),
      ...readdirSync(join(root, 'tests', 'fixtures')).map((f) => join(root, 'tests', 'fixtures', f)),
    ];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/INSERT\s+(OR\s+\w+\s+)?INTO\s+(reviews|requests|email_outbox)\b/i);
      expect(text, f).not.toMatch(/<rating|ratingValue|aggregateRating/i);
    }
  });
});
