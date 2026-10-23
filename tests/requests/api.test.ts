import { describe, expect, it } from 'vitest';
import { handleFormRequest } from '@/domain/requests/http';
import { addCategory, addProduct, createTestDb } from '../catalog/helpers';

const T0 = Date.UTC(2026, 9, 22, 12);

function setup() {
  const db = createTestDb();
  const productId = addProduct(db, { name: 'Триммер', slug: 'trimmer', categoryId: addCategory(db, 'Триммеры', 'trimmery') });
  const post = (kind: string, body: unknown, headers: Record<string, string> = {}) =>
    handleFormRequest(
      kind,
      new Request(`https://shop.test/api/forms/${kind}`, {
        method: 'POST',
        headers: { origin: 'https://shop.test', host: 'shop.test', 'content-type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      { db, now: T0 },
    );
  const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return { db, productId, post, count };
}

const callback = { name: 'Анна', phone: '+7 900 000-11-22', consent: true, website: '' };

describe('POST /api/forms/[kind]', () => {
  it('успех: 201 и номер заявки', async () => {
    const { post, count } = setup();
    const res = await post('callback', callback);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, number: 'ZV-000001' });
    expect(count('requests')).toBe(1);
  });

  it('чужой Origin и запрос без Origin отклоняются (403), заявка не создаётся', async () => {
    const { post, count } = setup();
    expect((await post('callback', callback, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await post('callback', callback, { origin: '', referer: '' })).status).toBe(403);
    expect(count('requests')).toBe(0);
  });

  it('ошибки валидации — 400 с ошибками по полям', async () => {
    const { post } = setup();
    const res = await post('callback', { ...callback, phone: '1', consent: false });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { fields: Record<string, string[]> } };
    expect(Object.keys(body.error.fields).sort()).toEqual(['consent', 'phone']);
  });

  it('honeypot: 201 как при успехе, но ничего не сохранено', async () => {
    const { post, count } = setup();
    const res = await post('callback', { ...callback, website: 'http://spam' });
    expect(res.status).toBe(201);
    expect(count('requests')).toBe(0);
    expect(count('consents')).toBe(0);
  });

  it('лимит: 11-й запрос с одного IP — 429 с Retry-After', async () => {
    const { post } = setup();
    for (let i = 0; i < 10; i++) expect((await post('callback', callback)).status).toBe(201);
    const res = await post('callback', callback);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('неизвестная форма — 404, битый JSON — 400, огромное тело — 413', async () => {
    const { post } = setup();
    expect((await post('hack', callback)).status).toBe(404);
    expect((await post('callback', '{не json')).status).toBe(400);
    expect((await post('callback', { ...callback, name: 'я'.repeat(30_000) })).status).toBe(413);
  });

  it('отзыв и вопрос принимаются по тем же правилам', async () => {
    const { post, productId, count } = setup();
    const review = await post('review', { productId, rating: 5, authorName: 'Мария', body: 'Отличный триммер, рекомендую', consent: true, website: '' });
    expect(review.status).toBe(201);
    const q = await post('question', { productId, name: 'Олег', email: 'oleg@example.com', message: 'Есть ли леска в комплекте?', consent: true, website: '' });
    expect(q.status).toBe(201);
    expect(count('reviews')).toBe(1);
    expect(count('requests')).toBe(1);
  });
});
