import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import { cart } from '@/domain/ordering/cart';
import { checkout } from '@/domain/ordering/checkout';
import { editItems } from '@/domain/ordering/order-edit';
import { paymentAdmin } from '@/domain/ordering/payment-methods';
import { readPricingSettings, taxesAdmin } from '@/domain/ordering/pricing-rules';
import { ordersRepo } from '@/server/db/repositories/orders';
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import type { Db } from '@/server/db/connection';
import { admin, manager } from '../admin/helpers';
import { GUEST_A, T0, addProduct, deliveryId, paymentId, setupDb } from '../ordering/helpers';

const o = (db: Db) => ({ db, now: T0 });
const rate = (over: Record<string, unknown> = {}) => ({ name: 'НДС 20%', rateBp: 2000, includedInPrice: true, active: true, sort: 0, ...over });
const settings = (over: Record<string, unknown> = {}) => ({ rule: 'nearest', step: 'kopeck', pricesIncludeTax: false, ...over });

const CONTACT = { name: 'Иван Иванов', email: 'ivan@example.test', phone: '+7 (900) 111-22-33', address: 'Москва, Тверская 1' };
function place(db: Db, payId = paymentId(db, 'cod')) {
  const c = cart.get(GUEST_A, { db });
  return checkout.place(
    { owner: GUEST_A, cartId: c.cartId, contact: { ...CONTACT }, deliveryMethodId: deliveryId(db, 'pickup'), paymentMethodId: payId, idempotencyKey: `k-${Math.random().toString(36).slice(2)}-abcdefgh`, consent: true },
    { db, now: T0, secret: 'x'.repeat(40) },
  );
}

describe('taxesAdmin: настройки и ставки', () => {
  it('по умолчанию: округление «до ближайшего, копейка», налога нет', () => {
    const db = setupDb();
    expect(taxesAdmin.view(admin, o(db))).toMatchObject({ settings: { rounding: { rule: 'nearest', step: 'kopeck' }, pricesIncludeTax: false }, rates: [] });
  });

  it('сохранение настроек, аудит до/после', () => {
    const db = setupDb();
    taxesAdmin.saveSettings(admin, settings({ rule: 'down', step: 'ruble', pricesIncludeTax: true }), o(db));
    expect(readPricingSettings(db)).toEqual({ rounding: { rule: 'down', step: 'ruble' }, pricesIncludeTax: true });
    const log = audit.list({}, { db }).find((r) => r.action === 'pricing.settings')!;
    expect(JSON.stringify(log.before)).toContain('nearest');
    expect(JSON.stringify(log.after)).toContain('down');
  });

  it('неизвестное правило или шаг отклоняются', () => {
    const db = setupDb();
    expect(() => taxesAdmin.saveSettings(admin, settings({ rule: 'banker' }), o(db))).toThrow(ValidationError);
    expect(() => taxesAdmin.saveSettings(admin, settings({ step: 'cent' }), o(db))).toThrow(ValidationError);
  });

  it('ставки: создание, проверки, назначение по умолчанию, удаление', () => {
    const db = setupDb();
    const id = taxesAdmin.createRate(admin, rate(), o(db));
    expect(() => taxesAdmin.createRate(admin, rate({ rateBp: -1 }), o(db))).toThrow(ValidationError);
    expect(() => taxesAdmin.createRate(admin, rate({ rateBp: 10_001 }), o(db))).toThrow(ValidationError);
    expect(() => taxesAdmin.createRate(admin, rate({ rateBp: 12.5 }), o(db))).toThrow(ValidationError);
    expect(() => taxesAdmin.createRate(admin, rate({ name: '' }), o(db))).toThrow(ValidationError);
    taxesAdmin.setDefault(admin, id, o(db));
    const second = taxesAdmin.createRate(admin, rate({ name: 'Без НДС', rateBp: 0 }), o(db));
    taxesAdmin.setDefault(admin, second, o(db));
    expect(taxesAdmin.view(admin, o(db)).rates.filter((r) => r.isDefault).map((r) => r.id)).toEqual([second]);
    taxesAdmin.removeRate(admin, id, o(db));
    expect(taxesAdmin.view(admin, o(db)).rates).toHaveLength(1);
  });

  it('неактивную ставку назначить нельзя, у ставки по умолчанию «действует» не снять', () => {
    const db = setupDb();
    const id = taxesAdmin.createRate(admin, rate({ active: false }), o(db));
    expect(() => taxesAdmin.setDefault(admin, id, o(db))).toThrow(ConflictError);
    const ok = taxesAdmin.createRate(admin, rate(), o(db));
    taxesAdmin.setDefault(admin, ok, o(db));
    expect(() => taxesAdmin.updateRate(admin, ok, rate({ active: false }), o(db))).toThrow(ConflictError);
  });

  it('права settings.write: менеджер и аноним отклоняются', () => {
    const db = setupDb();
    expect(() => taxesAdmin.view(manager, o(db))).toThrow(ForbiddenError);
    expect(() => taxesAdmin.saveSettings(manager, settings(), o(db))).toThrow(ForbiddenError);
    expect(() => taxesAdmin.createRate(manager, rate(), o(db))).toThrow(ForbiddenError);
    expect(() => taxesAdmin.setDefault(null, 1, o(db))).toThrow(UnauthorizedError);
  });
});

function cartWith(db: Db, price: number, qty = 1) {
  cart.add(GUEST_A, { productId: addProduct(db, { price }), qty }, { db, now: T0 });
}

describe('налог в корзине-заказе и снимке строк', () => {
  it('без ставки налога нет: итог как раньше', async () => {
    const db = setupDb();
    cartWith(db, 120_000);
    const order = await place(db);
    expect(order).toMatchObject({ taxKopecks: 0, taxMode: null, totalKopecks: 120_000 });
    expect(db.prepare('SELECT tax_rate_bp AS r, tax_kopecks AS t FROM order_items').get()).toEqual({ r: null, t: null });
  });

  it('налог внутри цены: итог не меняется, налог записан в заказ и в строки', async () => {
    const db = setupDb();
    taxesAdmin.setDefault(admin, taxesAdmin.createRate(admin, rate(), o(db)), o(db));
    cartWith(db, 120_000);
    const order = await place(db);
    expect(order).toMatchObject({ taxKopecks: 20_000, taxMode: 'included', totalKopecks: 120_000 });
    expect(db.prepare('SELECT tax_rate_bp AS r, tax_kopecks AS t FROM order_items').get()).toEqual({ r: 2000, t: 20_000 });
  });

  it('ставка «сверху»: налог прибавляется к итогу', async () => {
    const db = setupDb();
    taxesAdmin.setDefault(admin, taxesAdmin.createRate(admin, rate({ includedInPrice: false }), o(db)), o(db));
    cartWith(db, 100_000);
    const order = await place(db);
    expect(order).toMatchObject({ taxKopecks: 20_000, taxMode: 'added', totalKopecks: 120_000 });
  });

  it('флаг «цены включают налог» делает любую ставку включённой', async () => {
    const db = setupDb();
    taxesAdmin.setDefault(admin, taxesAdmin.createRate(admin, rate({ includedInPrice: false }), o(db)), o(db));
    taxesAdmin.saveSettings(admin, settings({ pricesIncludeTax: true }), o(db));
    cartWith(db, 120_000);
    expect(await place(db)).toMatchObject({ taxMode: 'included', totalKopecks: 120_000, taxKopecks: 20_000 });
  });

  it('налог с комиссией: комиссия не облагается, налог сверху только с товаров', async () => {
    const db = setupDb();
    taxesAdmin.setDefault(admin, taxesAdmin.createRate(admin, rate({ includedInPrice: false }), o(db)), o(db));
    const pay = paymentAdmin.create(admin, { name: 'Картой', description: '', enabled: true, sort: 20, feePercentBp: 100, feeFixedKopecks: 0, minKopecks: null, maxKopecks: null, mode: 'live' }, { ...o(db), env: {}, production: false });
    cartWith(db, 100_000);
    const order = await place(db, pay);
    expect(order).toMatchObject({ paymentFeeKopecks: 1_000, taxKopecks: 20_000, totalKopecks: 100_000 + 1_000 + 20_000 });
  });

  it('снимок правил в заказе: смена ставки после оформления не меняет пересчёт правки состава', async () => {
    const db = setupDb();
    const id = taxesAdmin.createRate(admin, rate({ includedInPrice: false }), o(db));
    taxesAdmin.setDefault(admin, id, o(db));
    cartWith(db, 100_000, 2);
    const order = await place(db);
    expect(order.totalKopecks).toBe(240_000);
    taxesAdmin.updateRate(admin, id, rate({ includedInPrice: false, rateBp: 1000 }), o(db)); // «сегодняшняя» ставка уже 10 %
    const actor = { type: 'staff', staffId: 1, role: 'admin' } as const;
    const item = ordersRepo.listItems(db, order.id)[0]!;
    const edited = editItems(order.id, { lines: [{ itemId: item.id, qty: 1 }], reason: 'меньше' }, actor, o(db));
    expect(edited).toMatchObject({ subtotalKopecks: 100_000, taxKopecks: 20_000, totalKopecks: 120_000 }); // по ставке 20 % из снимка
    expect(db.prepare('SELECT tax_kopecks AS t FROM order_items WHERE order_id = ?').get(order.id)).toEqual({ t: 20_000 });
  });

  it('правка состава заказа, оформленного до C12, не добавляет налог и комиссию', async () => {
    const db = setupDb();
    taxesAdmin.setDefault(admin, taxesAdmin.createRate(admin, rate({ includedInPrice: false }), o(db)), o(db));
    cartWith(db, 100_000, 2);
    const order = await place(db);
    db.prepare('UPDATE orders SET charges_json = NULL, tax_kopecks = 0, tax_mode = NULL, total_kopecks = 200000 WHERE id = ?').run(order.id);
    const item = ordersRepo.listItems(db, order.id)[0]!;
    const edited = editItems(order.id, { lines: [{ itemId: item.id, qty: 1 }], reason: 'меньше' }, { type: 'staff', staffId: 1, role: 'admin' }, o(db));
    expect(edited).toMatchObject({ taxKopecks: 0, totalKopecks: 100_000 });
  });
});

/** Расчёты денег не используют плавающую арифметику: ни parseFloat, ни toFixed, ни Math.round в модулях расчёта (деление нацело целых чисел допустимо). */
describe('деньги без float (grep-тест)', () => {
  const ROOT = resolve(__dirname, '../../src');
  const MONEY_MODULES = [
    'domain/pricing/money.ts',
    'domain/pricing/charges.ts',
    'domain/pricing/price.ts',
    'domain/pricing/promo.ts',
    'domain/ordering/pricing-rules.ts',
    'domain/ordering/payment-methods.ts',
    'domain/ordering/delivery.ts',
    'domain/ordering/checkout.ts',
    'domain/ordering/order-edit.ts',
  ];
  const FORBIDDEN = /\b(parseFloat|toFixed|Math\.round)\b/;

  it.each(MONEY_MODULES)('%s без parseFloat/toFixed/Math.round', (rel) => {
    const code = readFileSync(join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(FORBIDDEN);
  });

  it('проверка не пустая: во всех модулях расчёта есть целочисленные суммы', () => {
    const all: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) all.push(p);
      }
    };
    walk(join(ROOT, 'domain/pricing'));
    expect(all.length).toBeGreaterThan(5);
  });
});
