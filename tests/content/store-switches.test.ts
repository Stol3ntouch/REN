import { describe, expect, it } from 'vitest';
import { confirmEmail, EmailNotConfirmedError, login, register } from '@/domain/customers/auth';
import { setSetting } from '@/domain/content/settings';
import { assertPricesShown, DEFAULT_FLAGS, FLAGS_TTL_MS, getStoreFlags, invalidateStoreFlags, PricesHiddenError, RegistrationClosedError } from '@/domain/content/store-flags';
import { submitCallback } from '@/domain/requests/service';
import { cart } from '@/domain/ordering/cart';
import { checkout } from '@/domain/ordering/checkout';
import { settingsRepo } from '@/server/db/repositories/settings';
import { createTestDb } from '@/server/db/testing';
import { fakeCookies, T0 } from '../auth/helpers';
import { addProduct, deliveryId, GUEST_A, paymentId, setupDb } from '../ordering/helpers';

const creds = { email: 'anna@example.com', password: 'long-password-123', consent: true };
const ctx = (db: ReturnType<typeof createTestDb>, cookies = fakeCookies()) => ({ db, cookies, ip: '1.1.1.1', now: T0, siteUrl: 'https://shop.test' });
const mails = (db: ReturnType<typeof createTestDb>) =>
  (db.prepare('SELECT event, payload_json FROM mail_stub_queue ORDER BY id').all() as { event: string; payload_json: string }[]).map((r) => ({ event: r.event, payload: JSON.parse(r.payload_json) as Record<string, string> }));

describe('getStoreFlags', () => {
  it('значения по умолчанию повторяют поведение сайта до настроек', () => {
    const db = createTestDb();
    expect(getStoreFlags({ db })).toEqual(DEFAULT_FLAGS);
    expect(DEFAULT_FLAGS).toMatchObject({ storeEnabled: true, maintenance: false, showPrices: true, registration: true, emailConfirm: false, spamProtection: true });
  });

  it('кэшируется на короткое время и сбрасывается при сохранении через setSetting', () => {
    const db = createTestDb();
    expect(getStoreFlags({ db, now: 1000 }).showPrices).toBe(true);
    settingsRepo.set(db, 'flag_show_prices', '0', 1); // мимо setSetting: кэш держит старое
    expect(getStoreFlags({ db, now: 1000 + 10 }).showPrices).toBe(true);
    expect(getStoreFlags({ db, now: 1000 + FLAGS_TTL_MS + 1 }).showPrices).toBe(false);
    setSetting('flag_show_prices', '1', { db });
    expect(getStoreFlags({ db, now: 1000 + FLAGS_TTL_MS + 2 }).showPrices).toBe(true);
    invalidateStoreFlags(db);
  });
});

describe('«Разрешить регистрацию»', () => {
  it('выключен → register отклоняется на сервере, пользователь не создаётся', async () => {
    const db = createTestDb();
    setSetting('flag_registration', '0', { db });
    await expect(register(creds, ctx(db))).rejects.toBeInstanceOf(RegistrationClosedError);
    expect((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(0);
  });
});

describe('«Требовать подтверждение email»', () => {
  it('регистрация создаёт неподтверждённый аккаунт без сессии и ставит письмо со ссылкой', async () => {
    const db = createTestDb();
    setSetting('flag_email_confirm', '1', { db });
    const cookies = fakeCookies();
    const res = await register(creds, ctx(db, cookies));
    expect(res.confirmationRequired).toBe(true);
    expect(cookies.jar.size).toBe(0);
    const m = mails(db);
    expect(m).toHaveLength(1);
    expect(m[0]!.event).toBe('auth.email_confirm');
    expect(m[0]!.payload.confirmUrl!.startsWith('https://shop.test/account/confirm/')).toBe(true);
    const token = m[0]!.payload.confirmUrl!.split('/').pop()!;
    const hashes = db.prepare('SELECT token_hash FROM email_verifications').all() as { token_hash: string }[];
    expect(hashes[0]!.token_hash).not.toContain(token); // в БД только хеш
  });

  it('вход запрещён до подтверждения, после перехода по ссылке — разрешён; ссылка одноразовая', async () => {
    const db = createTestDb();
    setSetting('flag_email_confirm', '1', { db });
    await register(creds, ctx(db));
    await expect(login({ email: creds.email, password: creds.password }, ctx(db))).rejects.toBeInstanceOf(EmailNotConfirmedError);
    const token = mails(db).at(-1)!.payload.confirmUrl!.split('/').pop()!;
    confirmEmail(token, { db, now: T0 });
    expect(() => confirmEmail(token, { db, now: T0 })).toThrow();
    const cookies = fakeCookies();
    await expect(login({ email: creds.email, password: creds.password }, ctx(db, cookies))).resolves.toMatchObject({ userId: 1 });
  });

  it('пока переключатель выключен — прежнее поведение: сессия сразу', async () => {
    const db = createTestDb();
    const cookies = fakeCookies();
    const res = await register(creds, ctx(db, cookies));
    expect(res.confirmationRequired).toBeUndefined();
    expect(cookies.jar.size).toBeGreaterThan(0);
  });

  it('просроченная ссылка не работает', async () => {
    const db = createTestDb();
    setSetting('flag_email_confirm', '1', { db });
    await register(creds, ctx(db));
    const token = mails(db)[0]!.payload.confirmUrl!.split('/').pop()!;
    expect(() => confirmEmail(token, { db, now: T0 + 25 * 3_600_000 })).toThrow();
  });
});

describe('«Показывать цены»', () => {
  it('выключен → cart.add и checkout.place отказывают на сервере', async () => {
    const db = setupDb();
    const p = addProduct(db, { price: 10_000 });
    setSetting('flag_show_prices', '0', { db });
    expect(() => cart.add(GUEST_A, { productId: p, qty: 1 }, { db, now: T0 })).toThrow(PricesHiddenError);
    await expect(
      checkout.place(
        {
          owner: GUEST_A,
          cartId: 1,
          contact: { name: 'Пётр', email: 'p@example.test', phone: '+7 900 000-00-00' },
          deliveryMethodId: deliveryId(db, 'pickup'),
          paymentMethodId: paymentId(db, 'cod'),
          idempotencyKey: 'key-0123456789-abcdef',
          consent: true,
        },
        { db, now: T0 },
      ),
    ).rejects.toBeInstanceOf(PricesHiddenError);
    expect(() => assertPricesShown({ db })).toThrow();
  });

  it('включён → корзина работает как раньше', () => {
    const db = setupDb();
    const p = addProduct(db, { price: 10_000 });
    expect(cart.add(GUEST_A, { productId: p, qty: 1 }, { db, now: T0 }).items).toHaveLength(1);
  });
});

describe('«Защита форм от спама»', () => {
  const body = { name: 'Анна', phone: '+7 900 000-00-00', consent: true, website: 'http://spam.test' };

  it('включена → honeypot отбрасывает заявку без записи', async () => {
    const db = createTestDb();
    const res = await submitCallback(body, { db, now: T0, ip: '2.2.2.2' });
    expect(res.id).toBeNull();
  });

  it('выключена → honeypot не проверяется, заявка сохраняется (обязательная валидация остаётся)', async () => {
    const db = createTestDb();
    setSetting('flag_spam_protection', '0', { db });
    const res = await submitCallback(body, { db, now: T0, ip: '2.2.2.2' });
    expect(res.id).not.toBeNull();
    await expect(submitCallback({ ...body, name: '' }, { db, now: T0, ip: '2.2.2.2' })).rejects.toThrow();
  });
});
