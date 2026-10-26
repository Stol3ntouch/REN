import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { hasPermission } from '@/domain/admin/permissions';
import { applyPromo, resolvePrice, type Promo } from '@/domain/pricing';
import { priceLinesWithPromotions } from '@/domain/pricing/promotion-rules';
import { stock } from '@/domain/catalog/stock';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { stockRepo } from '@/server/db/repositories/stock';
import { methodsRepo } from '@/server/db/repositories/methods';
import { ordersRepo, type OrderRow } from '@/server/db/repositories/orders';
import { promosRepo, type PromoRow } from '@/server/db/repositories/promos';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type FieldErrors } from '@/server/http/errors';
import { contactSchema, phoneDigits } from './contact';
import { toOrder } from './order-view';
import { recalcCharges } from './pricing-rules';
import { CONTACT_EDITABLE_STATUSES, ITEMS_EDITABLE_STATUSES, STATUS_LABELS } from './status';
import { MAX_QTY, type Actor, type Opts, type Order } from './types';

const TEXT_MAX = 500;

function staffIdOf(actor: Actor): number {
  if (actor.type !== 'staff' || !hasPermission(actor, 'orders.write')) throw new ForbiddenError('Недостаточно прав');
  return actor.staffId;
}

function text(value: unknown, label: string): string {
  const t = typeof value === 'string' ? value.trim() : '';
  if (t === '') throw new ValidationError(`${label}: заполните поле`);
  if (t.length > TEXT_MAX) throw new ValidationError(`${label}: не длиннее ${TEXT_MAX} символов`);
  return t;
}

/**
 * Хватает ли товара на `extra` дополнительных штук: при включённом учёте (C04) — свободный остаток, иначе признак «в наличии».
 */
function canSupply(db: Db, productId: number, extra: number, inStockFlag: boolean): boolean {
  const row = stockRepo.get(db, productId);
  if (row?.tracked) return row.stockQty - row.reservedQty >= extra;
  return inStockFlag;
}

function load(db: Db, orderId: number): OrderRow {
  const row = Number.isInteger(orderId) ? ordersRepo.findById(db, orderId) : null;
  if (!row) throw new NotFoundError('Заказ не найден');
  return row;
}

function fieldsOf(error: z.ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) (fields[issue.path.join('.') || 'form'] ??= []).push(issue.message);
  return fields;
}

function invalid(error: z.ZodError): ValidationError {
  const fields = fieldsOf(error);
  return new ValidationError(Object.values(fields)[0]?.[0] ?? 'Проверьте введённые данные', fields);
}

// ---------------------------------------------------------------- контакты

const detailsSchema = contactSchema.partial();
export type OrderDetailsPatch = { name?: string; email?: string; phone?: string; address?: string | null; comment?: string | null };

const FIELD_LABELS: Record<string, string> = { name: 'имя', email: 'email', phone: 'телефон', address: 'адрес', comment: 'комментарий клиента' };

/** Контакты, адрес и комментарий клиента — до завершения заказа. Состав и суммы здесь не меняются. */
export function updateDetails(orderId: number, patch: OrderDetailsPatch, actor: Actor, opts: Opts = {}): Order {
  const by = staffIdOf(actor);
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const parsed = detailsSchema.safeParse(patch);
  if (!parsed.success) throw invalid(parsed.error);
  const next = parsed.data;
  if (Object.keys(next).length === 0) throw new ValidationError('Нечего менять: укажите хотя бы одно поле');

  return withTransaction(db, () => {
    const row = load(db, orderId);
    if (!CONTACT_EDITABLE_STATUSES.includes(row.status)) {
      throw new ConflictError(`Заказ в статусе «${STATUS_LABELS[row.status]}» править нельзя`);
    }
    const merged = {
      name: next.name ?? row.contactName,
      email: next.email ?? row.contactEmail,
      phone: next.phone ?? row.contactPhone,
      address: next.address !== undefined ? (next.address ?? null) : row.address,
      comment: next.comment !== undefined ? (next.comment ?? null) : row.comment,
    };
    const method = row.deliveryMethodId !== null ? methodsRepo.findDelivery(db, row.deliveryMethodId) : null;
    if (method?.requiresAddress && (merged.address === null || merged.address.length < 5)) {
      throw new ValidationError('Укажите адрес доставки', { address: ['Укажите адрес доставки'] });
    }
    const before: Record<string, string | null> = { name: row.contactName, email: row.contactEmail, phone: row.contactPhone, address: row.address, comment: row.comment };
    const changed = (Object.keys(next) as Array<keyof typeof merged>).filter((k) => merged[k] !== before[k]);
    if (changed.length === 0) return toOrder(db, row);
    ordersRepo.updateContact(db, row.id, { ...merged, phoneDigits: phoneDigits(merged.phone) }, now);
    const names = changed.map((k) => FIELD_LABELS[k] ?? k).join(', ');
    ordersRepo.insertEvent(db, { orderId: row.id, at: now, kind: 'edit', actorType: 'staff', actorId: String(by), note: `Изменено: ${names}` });
    // В аудит — только перечень полей: значения (имя, адрес, телефон, email) — персональные данные.
    audit.record({ actorId: by, actorType: 'staff', action: 'order.edit', entity: 'order', entityId: row.id, before: { number: row.number }, after: { changed } }, { db, now });
    return toOrder(db, ordersRepo.findById(db, row.id)!);
  });
}

// ---------------------------------------------------------------- состав

export type ItemsLine = { itemId?: number; productId?: number; qty: number };
export type ItemsInput = { lines: ItemsLine[]; reason: string };

const linesSchema = z.object({
  reason: z.string({ error: 'Укажите причину изменения' }).trim().min(1, 'Укажите причину изменения').max(TEXT_MAX, `Причина не длиннее ${TEXT_MAX} символов`),
  lines: z.array(
    z.object({
      itemId: z.number().int().positive().optional(),
      productId: z.number().int().positive().optional(),
      qty: z.number({ error: 'Укажите количество' }).int('Количество — целое число').min(0, 'Количество не может быть отрицательным').max(MAX_QTY, `Не больше ${MAX_QTY} шт. в строке`),
    }),
  ),
});

function toPromo(row: PromoRow): Promo {
  // Условия (срок, лимит, минимальная сумма) проверены при оформлении; здесь пересчитывается только размер скидки.
  return {
    code: row.code,
    type: row.type,
    value: row.value,
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    usedCount: 0,
    minSubtotalKopecks: 0,
    enabled: true,
    excludeOnSale: row.excludeOnSale,
  };
}

/**
 * «Изменить состав»: итоговый список строк. Существующая строка (itemId) сохраняет цену из снимка, меняется количество
 * (0 — убрать); новая (productId) берёт текущую цену каталога. Суммы и скидка купона считает сервер.
 * Только до передачи в доставку, для неоплаченного заказа, при наличии товара; пишется событие items и аудит.
 */
export function editItems(orderId: number, input: ItemsInput, actor: Actor, opts: Opts = {}): Order {
  const by = staffIdOf(actor);
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const parsed = linesSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error);
  const { lines, reason } = parsed.data;

  return withTransaction(db, () => {
    const row = load(db, orderId);
    if (!ITEMS_EDITABLE_STATUSES.includes(row.status)) {
      throw new ConflictError(`Состав нельзя менять в статусе «${STATUS_LABELS[row.status]}»: заказ уже передан в доставку или завершён`);
    }
    if (row.isPaid || ordersRepo.hasLivePayment(db, row.id)) {
      throw new ConflictError('Заказ оплачен или оплата в процессе: изменение суммы возможно только через возврат средств');
    }
    const existing = ordersRepo.listItems(db, row.id);
    const byId = new Map(existing.map((i) => [i.id, i]));
    const usedProducts = new Set<number>();
    const keep: Array<{ itemId: number; qty: number }> = [];
    const add: Array<{ productId: number; qty: number }> = [];

    for (const l of lines) {
      if (l.itemId !== undefined) {
        const item = byId.get(l.itemId);
        if (!item) throw new NotFoundError('Строка заказа не найдена');
        if (l.qty > 0) {
          if (item.productId !== null) usedProducts.add(item.productId);
          keep.push({ itemId: item.id, qty: l.qty });
        }
      } else if (l.productId !== undefined) {
        if (l.qty < 1) continue;
        add.push({ productId: l.productId, qty: l.qty });
      } else {
        throw new ValidationError('Строка без товара: укажите itemId или productId');
      }
    }
    for (const a of add) {
      if (usedProducts.has(a.productId)) throw new ValidationError('Товар уже в заказе — измените количество в его строке');
      usedProducts.add(a.productId);
    }
    if (keep.length + add.length === 0) throw new ValidationError('В заказе должна остаться хотя бы одна позиция');

    // наличие: для новых строк и увеличения количества
    for (const k of keep) {
      const item = byId.get(k.itemId)!;
      if (k.qty > item.qty) {
        const p = item.productId !== null ? ordersRepo.findProductForOrder(db, item.productId) : null;
        if (!p || !p.published || !canSupply(db, p.id, k.qty - item.qty, p.inStock)) {
          throw new ConflictError(`Нельзя увеличить количество: «${item.name}» недоступен в нужном количестве`);
        }
      }
    }
    const priced: Array<{ productId: number; name: string; sku: string | null; price: number; discount: number | null; unit: number; qty: number }> = [];
    for (const a of add) {
      const p = ordersRepo.findProductForOrder(db, a.productId);
      if (!p) throw new NotFoundError('Товар не найден');
      if (!p.published || !canSupply(db, p.id, a.qty, p.inStock)) throw new ConflictError(`Товар «${p.name}» недоступен: нет в наличии или снят с продажи`);
      const own = resolvePrice({ priceKopecks: p.priceKopecks, discountPriceKopecks: p.discountPriceKopecks });
      const promo = priceLinesWithPromotions(db, [{ productId: p.id, listKopecks: p.priceKopecks, ownKopecks: own.unit, qty: a.qty }], now).get(p.id);
      const unit = promo ? promo.unit : own.unit;
      priced.push({ productId: p.id, name: p.name, sku: p.sku, price: p.priceKopecks, discount: unit < p.priceKopecks ? unit : null, unit, qty: a.qty });
    }

    // запись: убрать, обновить, добавить
    const keepIds = new Set(keep.map((k) => k.itemId));
    for (const item of existing) if (!keepIds.has(item.id)) ordersRepo.deleteItem(db, item.id);
    for (const k of keep) {
      const item = byId.get(k.itemId)!;
      ordersRepo.updateItem(db, item.id, k.qty, item.unitKopecks * k.qty);
    }
    for (const p of priced) {
      ordersRepo.insertItem(db, row.id, {
        productId: p.productId,
        name: p.name,
        sku: p.sku,
        priceKopecks: p.price,
        discountPriceKopecks: p.discount,
        unitKopecks: p.unit,
        qty: p.qty,
        lineKopecks: p.unit * p.qty,
      });
    }

    // пересчёт сумм на сервере
    const finalItems = ordersRepo.listItems(db, row.id);
    const subtotal = finalItems.reduce((s, i) => s + i.lineKopecks, 0);
    let discount = 0;
    if (row.promoId !== null) {
      const promo = promosRepo.findById(db, row.promoId);
      if (promo) {
        discount = applyPromo(
          { items: finalItems.map((i) => ({ productId: i.productId ?? 0, unit: i.unitKopecks, qty: i.qty, onSale: i.unitKopecks < i.priceKopecks })), subtotal },
          toPromo(promo),
          new Date(now),
        ).discount;
      }
    }
    // C12: комиссия и налог пересчитываются по правилам, зафиксированным в заказе при оформлении (заказы до C12 — без надбавок).
    const charges = recalcCharges(row.chargesJson, { lines: finalItems.map((i) => i.lineKopecks), discountKopecks: discount, deliveryKopecks: row.deliveryKopecks });
    const total = charges.totalKopecks;
    ordersRepo.setTotals(
      db,
      row.id,
      { subtotalKopecks: subtotal, discountKopecks: discount, totalKopecks: total, paymentFeeKopecks: charges.feeKopecks, taxKopecks: charges.taxKopecks, taxMode: charges.taxMode },
      now,
    );
    finalItems.forEach((it, idx) => ordersRepo.setItemTax(db, it.id, charges.rules.tax?.rateBp ?? null, charges.lineTaxKopecks[idx] ?? null));

    // новые товары с включённым учётом резервируются (C04, идемпотентно по заказу и товару); не хватает — вся правка откатывается
    if (priced.length > 0) stock.reserveForOrder(row.id, priced.map((x) => ({ productId: x.productId, qty: x.qty })), { db, now });

    ordersRepo.insertEvent(db, {
      orderId: row.id,
      at: now,
      kind: 'items',
      actorType: 'staff',
      actorId: String(by),
      note: `${reason} (позиций ${existing.length} → ${finalItems.length}, итог ${row.totalKopecks} → ${total} коп.)`,
    });
    audit.record(
      {
        actorId: by,
        actorType: 'staff',
        action: 'order.items',
        entity: 'order',
        entityId: row.id,
        before: { items: existing.length, subtotalKopecks: row.subtotalKopecks, discountKopecks: row.discountKopecks, totalKopecks: row.totalKopecks },
        after: { items: finalItems.length, subtotalKopecks: subtotal, discountKopecks: discount, totalKopecks: total, reason },
      },
      { db, now },
    );
    return toOrder(db, ordersRepo.findById(db, row.id)!);
  });
}

// ---------------------------------------------------------------- оплата вручную

/**
 * «Отметить оплаченным» — административный процесс для оплаты при получении / вне системы. Требует права orders.write,
 * явного подтверждения и комментария. Онлайн-оплата подтверждается ТОЛЬКО проверенным webhook; статус заказа не меняется.
 */
export function markPaidManually(orderId: number, input: { comment: string; confirm: boolean }, actor: Actor, opts: Opts = {}): Order {
  const by = staffIdOf(actor);
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  if (input?.confirm !== true) throw new ValidationError('Подтвердите действие: оплата отмечается вручную и попадает в журнал');
  const comment = text(input.comment, 'Комментарий');
  return withTransaction(db, () => {
    const row = load(db, orderId);
    if (row.status === 'cancelled' || row.status === 'refunded') throw new ConflictError(`Заказ в статусе «${STATUS_LABELS[row.status]}»: оплату отметить нельзя`);
    if (row.isPaid) throw new ConflictError('Заказ уже отмечен оплаченным');
    if (row.paymentKind === 'online') throw new ConflictError('Онлайн-оплату подтверждает только платёжная система (webhook): вручную она не отмечается');
    ordersRepo.setPaidFlag(db, row.id, now);
    ordersRepo.insertEvent(db, { orderId: row.id, at: now, kind: 'payment.manual', actorType: 'staff', actorId: String(by), note: comment });
    audit.record(
      { actorId: by, actorType: 'staff', action: 'payment.manual', entity: 'order', entityId: row.id, before: { isPaid: false }, after: { isPaid: true, comment, paymentCode: row.paymentCode } },
      { db, now },
    );
    return toOrder(db, ordersRepo.findById(db, row.id)!);
  });
}

// ---------------------------------------------------------------- внутренние комментарии

/** Внутренний комментарий сотрудника: отдельная запись (автор, время) + след в истории. Покупатель его не видит. */
export function addInternalComment(orderId: number, body: string, actor: Actor, opts: Opts = {}): number {
  const by = staffIdOf(actor);
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const t = text(body, 'Комментарий');
  return withTransaction(db, () => {
    load(db, orderId);
    const id = ordersRepo.insertComment(db, orderId, by, t, now);
    ordersRepo.insertEvent(db, { orderId, at: now, kind: 'note', actorType: 'staff', actorId: String(by), note: t });
    return id;
  });
}
