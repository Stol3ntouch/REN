import { describe, expect, it } from 'vitest';
import { submitCallback, submitContact, submitQuestion, submitRepair, submitReview } from '@/domain/requests/service';
import { RateLimitError, ValidationError } from '@/server/http/errors';
import { addCategory, addProduct, createTestDb } from '../catalog/helpers';

const T0 = Date.UTC(2026, 9, 22, 12);

function setup() {
  const db = createTestDb();
  const productId = addProduct(db, { name: 'Триммер Champion', slug: 'trimmer', categoryId: addCategory(db, 'Триммеры', 'trimmery') });
  const hiddenId = addProduct(db, { name: 'Скрытый', slug: 'hidden', categoryId: addCategory(db, 'Прочее', 'prochee'), published: false });
  const ctx = (ip = '10.0.0.1', now = T0) => ({ db, now, ip, owner: { kind: 'guest' as const, guestId: 'g-1' } });
  const rows = (sql: string) => db.prepare(sql).all() as Record<string, unknown>[];
  const mails = () => rows('SELECT event, payload_json FROM mail_stub_queue ORDER BY id').map((r) => ({ event: r.event as string, payload: JSON.parse(r.payload_json as string) as Record<string, unknown> }));
  return { db, productId, hiddenId, ctx, rows, mails };
}

const repair = { name: 'Иван Петров', phone: '8 (916) 123-45-67', equipmentType: 'Бензопила', description: 'Не заводится после зимы, шнур стартера оборван', preferredContact: 'phone', consent: true, website: '' };

describe('заявка на ремонт', () => {
  it('сохраняется с номером и статусом «новая», согласие записано, менеджерам уходит событие', async () => {
    const { ctx, rows, mails } = setup();
    const res = await submitRepair(repair, ctx());
    expect(res.number).toBe('REM-000001');
    expect(rows('SELECT kind, status, name, phone, equipment_type FROM requests')).toEqual([
      { kind: 'repair', status: 'new', name: 'Иван Петров', phone: '+79161234567', equipment_type: 'Бензопила' },
    ]);
    const consents = rows('SELECT kind, source, guest_id, subject FROM consents');
    expect(consents).toEqual([{ kind: 'privacy', source: 'repair', guest_id: 'g-1', subject: 'REM-000001' }]);
    expect(rows('SELECT consent_id FROM requests')[0]!.consent_id).not.toBeNull();
    expect(mails().map((m) => m.event)).toEqual(['repair.created']);
    expect(mails()[0]!.payload).toMatchObject({ number: 'REM-000001', equipmentType: 'Бензопила' });
  });

  it('без согласия, с коротким описанием и плохим телефоном — честные ошибки по полям, ничего не сохраняется', async () => {
    const { ctx, rows } = setup();
    const err = (await submitRepair({ ...repair, consent: false, description: 'сломано', phone: '12' }, ctx()).catch((e) => e)) as ValidationError;
    expect(err).toBeInstanceOf(ValidationError);
    expect(Object.keys(err.fields).sort()).toEqual(['consent', 'description', 'phone']);
    expect(err.fields.consent![0]).toContain('согласие');
    expect(rows('SELECT id FROM requests')).toHaveLength(0);
    expect(rows('SELECT id FROM consents')).toHaveLength(0);
  });

  it('способ связи «email» требует адрес', async () => {
    const { ctx } = setup();
    const err = (await submitRepair({ ...repair, preferredContact: 'email' }, ctx()).catch((e) => e)) as ValidationError;
    expect(Object.keys(err.fields)).toEqual(['email']);
  });

  it('honeypot: заполненное поле website тихо отбрасывается — ни заявки, ни письма, ни согласия, ответ как при успехе', async () => {
    const { ctx, rows, mails } = setup();
    const res = await submitRepair({ ...repair, website: 'http://spam.example' }, ctx());
    expect(res).toEqual({ id: null, number: null });
    expect(rows('SELECT id FROM requests')).toHaveLength(0);
    expect(rows('SELECT id FROM consents')).toHaveLength(0);
    expect(mails()).toHaveLength(0);
  });

  it('лимит по IP: 11-я заявка с одного адреса за час отклоняется, с другого адреса и через час — проходит', async () => {
    const { ctx } = setup();
    for (let i = 0; i < 10; i++) await submitRepair(repair, ctx());
    expect(await submitRepair(repair, ctx()).catch((e) => e)).toBeInstanceOf(RateLimitError);
    await expect(submitRepair(repair, ctx('10.0.0.2'))).resolves.toMatchObject({ number: expect.any(String) });
    await expect(submitRepair(repair, ctx('10.0.0.1', T0 + 3_700_000))).resolves.toMatchObject({ number: expect.any(String) });
  });
});

describe('звонок, обратная связь, вопрос', () => {
  it('заказ звонка: имя, телефон, согласие', async () => {
    const { ctx, rows, mails } = setup();
    const res = await submitCallback({ name: 'Анна', phone: '+7 900 000-11-22', consent: true, website: '' }, ctx());
    expect(res.number).toBe('ZV-000001');
    expect(rows('SELECT kind, phone FROM requests')).toEqual([{ kind: 'callback', phone: '+79000001122' }]);
    expect(mails()[0]!.event).toBe('callback.created');
    expect(rows('SELECT source FROM consents')).toEqual([{ source: 'callback' }]);
  });

  it('обратная связь требует email и сообщение', async () => {
    const { ctx } = setup();
    const err = (await submitContact({ name: 'Анна', email: 'не-почта', message: 'Привет', consent: true, website: '' }, ctx()).catch((e) => e)) as ValidationError;
    expect(Object.keys(err.fields).sort()).toEqual(['email', 'message']);
    await expect(submitContact({ name: 'Анна', email: 'anna@example.com', message: 'Подскажите режим работы в праздники', consent: true, website: '' }, ctx())).resolves.toMatchObject({ number: 'MSG-000001' });
  });

  it('вопрос о товаре привязан к товару; о скрытом или несуществующем товаре — ошибка', async () => {
    const { ctx, productId, hiddenId, rows, mails } = setup();
    const q = { name: 'Олег', email: 'oleg@example.com', message: 'Подойдёт ли леска 2.4 мм?', consent: true, website: '' };
    const res = await submitQuestion({ ...q, productId }, ctx());
    expect(res.number).toBe('VOP-000001');
    expect(rows('SELECT kind, product_id FROM requests')).toEqual([{ kind: 'question', product_id: productId }]);
    expect(mails()[0]!.payload).toMatchObject({ productName: 'Триммер Champion' });
    await expect(submitQuestion({ ...q, productId: hiddenId }, ctx())).rejects.toThrow();
    await expect(submitQuestion({ ...q, productId: 99999 }, ctx())).rejects.toThrow();
  });
});

describe('отзыв', () => {
  const review = (productId: number, over: Record<string, unknown> = {}) => ({ productId, rating: 5, authorName: 'Мария', body: 'Работает отлично, завожу с первого раза', consent: true, website: '', ...over });

  it('сохраняется со статусом pending, не публикуется сам; менеджерам уходит событие', async () => {
    const { ctx, productId, rows, mails } = setup();
    await submitReview(review(productId), ctx());
    expect(rows('SELECT status, rating, product_id FROM reviews')).toEqual([{ status: 'pending', rating: 5, product_id: productId }]);
    expect(mails()[0]).toMatchObject({ event: 'review.created', payload: { productName: 'Триммер Champion', rating: 5 } });
    expect(rows('SELECT source FROM consents')).toEqual([{ source: 'review' }]);
  });

  it('оценка только 1–5', async () => {
    const { ctx, productId } = setup();
    for (const rating of [0, 6, 2.5, '5x']) {
      const err = (await submitReview(review(productId, { rating }), ctx()).catch((e) => e)) as ValidationError;
      expect(err, String(rating)).toBeInstanceOf(ValidationError);
      expect(Object.keys(err.fields)).toEqual(['rating']);
    }
  });

  it('лимит отзывов — 3 в час с одного IP', async () => {
    const { ctx, productId } = setup();
    for (let i = 0; i < 3; i++) await submitReview(review(productId), ctx());
    expect(await submitReview(review(productId), ctx()).catch((e) => e)).toBeInstanceOf(RateLimitError);
    // лимит отзывов отдельный: другая форма с этого же IP работает
    await expect(submitCallback({ name: 'Анна', phone: '+7 900 000-11-22', consent: true, website: '' }, ctx())).resolves.toBeTruthy();
  });
});
