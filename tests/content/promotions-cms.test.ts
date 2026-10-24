import { describe, expect, it } from 'vitest';
import { contentOps } from '@/domain/content/ops';
import { getPublishedPromotion, listActivePromotions } from '@/domain/content/queries';
import { cart } from '@/domain/ordering/cart';
import { promoOps } from '@/domain/ordering/admin-ops';
import { auditRepo } from '@/server/db/repositories/audit';
import { promosRepo } from '@/server/db/repositories/promos';
import { promotionsRepo } from '@/server/db/repositories/promotions';
import { createTestDb } from '@/server/db/testing';
import { ForbiddenError, ValidationError } from '@/server/http/errors';
import { GUEST_A, addProduct } from '../ordering/helpers';
import { ADMIN, MANAGER, T0 } from './helpers';

const DAY = 86_400_000;
type Db = ReturnType<typeof createTestDb>;
const ctx = (db: Db, now = T0) => ({ db, now });
const promo = (db: Db, extra: Record<string, unknown>) =>
  contentOps.promotions.save(ADMIN, null, { title: 'Акция', published: true, discountType: 'percent', discountValue: 10, startsAt: T0 - DAY, endsAt: T0 + DAY, ...extra } as never, ctx(db));
const catOf = (db: Db, productId: number) => (db.prepare('SELECT category_id AS c FROM products WHERE id = ?').get(productId) as { c: number }).c;

describe('акции: правила сохранения', () => {
  it('информирующая акция (без скидки) сохраняется как раньше: период, условия, товары не нужны', async () => {
    const db = createTestDb();
    const { id } = await contentOps.promotions.save(ADMIN, null, { title: 'Весна', published: true, conditions: 'Только в магазине', startsAt: T0 - DAY, endsAt: T0 + DAY }, ctx(db));
    expect(promotionsRepo.get(db, id)).toMatchObject({ discountType: 'none', discountValue: 0, conditions: 'Только в магазине', priority: 0 });
    expect(listActivePromotions({ db, now: T0 }).map((p) => p.id)).toEqual([id]);
    expect(listActivePromotions({ db, now: T0 + 2 * DAY })).toEqual([]);
    expect(getPublishedPromotion('vesna', { db })?.id).toBe(id); // после окончания страница открывается
  });

  it('скидка требует товаров или категорий; проценты 1–99; фиксированная скидка меньше цены самого дешёвого товара', async () => {
    const db = createTestDb();
    const cheap = addProduct(db, { price: 50_000 });
    addProduct(db, { price: 90_000 });
    await expect(promo(db, { productIds: [] })).rejects.toBeInstanceOf(ValidationError);
    await expect(promo(db, { productIds: [cheap], discountValue: 100 })).rejects.toBeInstanceOf(ValidationError);
    await expect(promo(db, { productIds: [cheap], discountValue: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(promo(db, { productIds: [cheap], discountType: 'fixed', discountValue: 50_000 })).rejects.toThrow(/нулевой/);
    await expect(promo(db, { productIds: [cheap], discountType: 'fixed', discountValue: 49_999 })).resolves.toBeDefined();
    await expect(promo(db, { productIds: [999_999] })).rejects.toBeInstanceOf(ValidationError);
    await expect(promo(db, { categoryIds: [999_999] })).rejects.toBeInstanceOf(ValidationError);
  });

  it('несовместимые акции не сохраняются: пересечение по товарам и датам с тем же приоритетом; разный приоритет — можно', async () => {
    const db = createTestDb();
    const p = addProduct(db, { name: 'Триммер' });
    const other = addProduct(db);
    await promo(db, { title: 'Первая', productIds: [p], priority: 1 });
    await expect(promo(db, { title: 'Вторая', productIds: [p], priority: 1 })).rejects.toThrow(/Триммер.*Первая/);
    await expect(promo(db, { title: 'Вторая', categoryIds: [catOf(db, p)], priority: 1 })).rejects.toBeInstanceOf(ValidationError); // категория содержит тот же товар
    await expect(promo(db, { title: 'Не пересекается по датам', productIds: [p], priority: 1, startsAt: T0 + 5 * DAY, endsAt: T0 + 9 * DAY })).resolves.toBeDefined();
    await expect(promo(db, { title: 'Другой товар', productIds: [other], priority: 1 })).resolves.toBeDefined();
    await expect(promo(db, { title: 'Выше приоритетом', productIds: [p], priority: 2 })).resolves.toBeDefined();
    expect(promotionsRepo.count(db)).toBe(4);
  });

  it('включить в списке акцию, которая конфликтует, нельзя; черновик конфликтов не создаёт', async () => {
    const db = createTestDb();
    const p = addProduct(db);
    await promo(db, { title: 'Раз', productIds: [p] });
    const draft = (await promo(db, { title: 'Два', productIds: [p], published: false })).id;
    await expect(contentOps.visibility.set(ADMIN, 'promotions', draft, true, ctx(db))).rejects.toBeInstanceOf(ValidationError);
    expect(promotionsRepo.get(db, draft)?.published).toBe(false);
  });

  it('участники сохраняются, дублирование переносит их и делает копию черновиком; менеджер — 403; аудит записан', async () => {
    const db = createTestDb();
    const p = addProduct(db);
    const { id } = await promo(db, { productIds: [p] });
    expect(promotionsRepo.targets(db, id)).toEqual({ productIds: [p], categoryIds: [] });
    const copy = (await contentOps.promotions.duplicate(ADMIN, id, ctx(db))).id;
    expect(promotionsRepo.get(db, copy)).toMatchObject({ published: false, promoCode: null });
    expect(promotionsRepo.targets(db, copy).productIds).toEqual([p]);
    await expect(contentOps.promotions.save(MANAGER, null, { title: 'x' }, ctx(db))).rejects.toBeInstanceOf(ForbiddenError);
    expect(auditRepo.list(db, { entity: 'content_promotions' }).map((a) => a.action)).toEqual(expect.arrayContaining(['content.promotions.create', 'content.promotions.duplicate']));
  });
});

describe('акции: итоговая цена в корзине считается на сервере', () => {
  it('акционная цена применяется к участнику, не к остальным; без акции или вне периода — обычная', async () => {
    const db = createTestDb();
    const a = addProduct(db, { price: 100_000 });
    const b = addProduct(db, { price: 100_000 });
    await promo(db, { productIds: [a], discountValue: 20 });
    cart.add(GUEST_A, { productId: a, qty: 2 }, { db, now: T0 });
    const view = cart.add(GUEST_A, { productId: b, qty: 1 }, { db, now: T0 });
    const line = (id: number) => view.items.find((i) => i.productId === id)!;
    expect(line(a)).toMatchObject({ unitKopecks: 80_000, originalKopecks: 100_000, lineKopecks: 160_000 });
    expect(line(b)).toMatchObject({ unitKopecks: 100_000, originalKopecks: null });
    expect(view.subtotalKopecks).toBe(260_000);
    // период закончился — цена вернулась
    expect(cart.get(GUEST_A, { db, now: T0 + 3 * DAY }).items.find((i) => i.productId === a)?.unitKopecks).toBe(100_000);
  });

  it('действует одна акция — с максимальным приоритетом; своя скидочная цена товара не суммируется, берётся более низкая', async () => {
    const db = createTestDb();
    const a = addProduct(db, { price: 100_000 });
    const sale = addProduct(db, { price: 100_000, discount: 70_000 });
    await promo(db, { title: 'Слабая', productIds: [a, sale], discountValue: 10, priority: 1 });
    await promo(db, { title: 'Сильная', productIds: [a, sale], discountValue: 30, priority: 2, startsAt: T0 - DAY });
      // (периоды пересекаются, но приоритеты разные — допустимо)
    cart.add(GUEST_A, { productId: a, qty: 1 }, { db, now: T0 });
    const view = cart.add(GUEST_A, { productId: sale, qty: 1 }, { db, now: T0 });
    expect(view.items.find((i) => i.productId === a)?.unitKopecks).toBe(70_000); // победила «Сильная» 30%
    expect(view.items.find((i) => i.productId === sale)?.unitKopecks).toBe(70_000); // 100 000 − 30% = 70 000 = своя скидка, не 49 000
  });

  it('минимальная сумма корзины: ниже — обычные цены; верхняя граница скидки; цена не уходит в ноль', async () => {
    const db = createTestDb();
    const a = addProduct(db, { price: 100_000 });
    await promo(db, { productIds: [a], discountType: 'percent', discountValue: 50, minSubtotalKopecks: 150_000, maxDiscountKopecks: 20_000 });
    expect(cart.add(GUEST_A, { productId: a, qty: 1 }, { db, now: T0 }).items[0]?.unitKopecks).toBe(100_000);
    const two = cart.setQty(GUEST_A, a, 2, { db, now: T0 });
    expect(two.items[0]?.unitKopecks).toBe(80_000); // 50% ограничено 200 ₽ на единицу
    expect(cart.changes(GUEST_A, { db, now: T0 })).toEqual([]); // собственное действие покупателя не считается «изменением цены»
    expect(two.totalKopecks).toBe(160_000);
  });
});

describe('купоны: один на заказ, несовместимость с акционной ценой, отчёт', () => {
  it('купон с excludeOnSale считается только от позиций без акции; без флага — от всей суммы', async () => {
    const db = createTestDb();
    const a = addProduct(db, { price: 100_000 });
    const b = addProduct(db, { price: 100_000 });
    await promo(db, { productIds: [a], discountValue: 20 });
    promoOps.create(ADMIN, { code: 'ALL10', type: 'percent', value: 10, startsAt: null, endsAt: null, usageLimit: null, minSubtotalKopecks: 0, enabled: true }, ctx(db));
    promoOps.create(ADMIN, { code: 'FULL10', type: 'percent', value: 10, startsAt: null, endsAt: null, usageLimit: null, minSubtotalKopecks: 0, enabled: true, excludeOnSale: true }, ctx(db));
    cart.add(GUEST_A, { productId: a, qty: 1 }, { db, now: T0 });
    cart.add(GUEST_A, { productId: b, qty: 1 }, { db, now: T0 });
    expect(cart.applyPromo(GUEST_A, 'ALL10', { db, now: T0 }).cart.discountKopecks).toBe(18_000); // 10% от 180 000
    const second = cart.applyPromo(GUEST_A, 'FULL10', { db, now: T0 });
    expect(second.cart.discountKopecks).toBe(10_000); // 10% только от товара без акции
    expect(second.cart.promo?.code).toBe('FULL10'); // в заказе один купон: новый заменяет прежний
  });

  it('отчёт об использовании: заказы с купоном и итоги без отменённых', () => {
    const db = createTestDb();
    const created = promoOps.create(ADMIN, { code: 'REP', type: 'fixed', value: 50_000, startsAt: null, endsAt: null, usageLimit: null, minSubtotalKopecks: 0, enabled: true }, ctx(db));
    const ins = db.prepare(
      `INSERT INTO orders (number, status, delivery_code, delivery_name, delivery_kind, payment_code, payment_name, payment_kind, subtotal_kopecks, discount_kopecks, total_kopecks, promo_id, promo_code, idempotency_key, guest_id, contact_name, contact_name_lc, contact_email, contact_phone, phone_digits, created_at, updated_at)
       VALUES (?, ?, 'pickup', 'Самовывоз', 'pickup', 'cash', 'При получении', 'offline', 200000, 50000, 150000, ?, 'REP', ?, 'g-1', 'Имя', 'имя', 'a@b.test', '+70000000000', '70000000000', ?, ?)`,
    );
    ins.run('RTS-000001', 'processing', created.id, 'key-0000000000001', T0, T0);
    ins.run('RTS-000002', 'cancelled', created.id, 'key-0000000000002', T0 + 1, T0 + 1);
    const totals = promosRepo.usageTotals(db, created.id);
    expect(totals).toEqual({ orders: 1, discountKopecks: 50_000, revenueKopecks: 150_000 });
    expect(promosRepo.usage(db, created.id).map((r) => r.orderNumber)).toEqual(['RTS-000002', 'RTS-000001']);
  });

  it('список купонов: серверный поиск по коду, фильтр, сортировка и страницы', () => {
    const db = createTestDb();
    for (const [i, code] of ['SPRING1', 'SPRING2', 'WINTER1'].entries()) {
      promoOps.create(ADMIN, { code, type: 'percent', value: 5, startsAt: null, endsAt: i === 2 ? T0 - DAY : null, usageLimit: null, minSubtotalKopecks: 0, enabled: i !== 1 }, ctx(db, T0 + i));
    }
    const list = (f: object) => promosRepo.search(db, { limit: 2, offset: 0, ...f }, T0);
    expect(list({ q: 'spring' }).rows.map((p) => p.code)).toEqual(['SPRING2', 'SPRING1']);
    expect(list({ status: 'disabled' }).rows.map((p) => p.code)).toEqual(['SPRING2']);
    expect(list({ status: 'expired' }).rows.map((p) => p.code)).toEqual(['WINTER1']);
    const page1 = list({ sort: 'code', dir: 'asc' });
    expect(page1.total).toBe(3);
    expect(page1.rows.map((p) => p.code)).toEqual(['SPRING1', 'SPRING2']);
    expect(promosRepo.search(db, { sort: 'code', dir: 'asc', limit: 2, offset: 2 }, T0).rows.map((p) => p.code)).toEqual(['WINTER1']);
    expect(list({ q: '%' }).total).toBe(0); // спецсимволы LIKE экранируются
  });
});
