import { assertPricesShown } from '@/domain/content/store-flags';
import { audit } from '@/domain/admin/audit';
import { enqueueMail } from '@/domain/admin/mail-enqueue';
import { notify } from '@/domain/admin/notifications';
import { stock } from '@/domain/catalog/stock';
import { consent } from '@/domain/customers/consent';
import type { PricedCart } from '@/domain/pricing';
import { orderCharges } from '@/domain/pricing/charges';
import { getPaymentPort, isProductionEnv } from '@/integrations/payment/select';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { cartsRepo, type CartRow } from '@/server/db/repositories/carts';
import { methodsRepo, type DeliveryMethodRow, type PaymentMethodRow } from '@/server/db/repositories/methods';
import { ordersRepo } from '@/server/db/repositories/orders';
import { promosRepo } from '@/server/db/repositories/promos';
import { usersRepo } from '@/server/db/repositories/users';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/server/http/errors';
import type { OwnerRef } from '@/server/http/owner';
import { cart as cartApi, computeCart } from './cart';
import { parsePlaceInput, phoneDigits } from './contact';
import { quoteDelivery } from './delivery';
import { paymentLimitProblem } from './payment-methods';
import { chargeRulesFor, serializeRules } from './pricing-rules';
import { orderUrlFor, toOrder } from './orders';
import type { CartView, Change, Opts, Order } from './types';

export type CheckoutOpts = Opts & {
  /** Подмена production-режима в тестах; по умолчанию берётся из конфигурации. */
  production?: boolean;
};

/** Корзина изменилась с момента, когда покупатель её видел: заказ не создан до подтверждения. */
export class CheckoutChangesError extends ConflictError {
  constructor(readonly changes: Change[]) {
    super('Цены или наличие изменились. Проверьте корзину и подтвердите изменения.');
  }
}

export type ValidatedCart = PricedCart & { discount: number; totalKopecks: number; view: CartView };

/** Единое определение production для оформления и платежей: NODE_ENV или APP_ENV = production. */
function isProduction(opts: CheckoutOpts): boolean {
  return opts.production !== undefined ? opts.production : isProductionEnv();
}

/**
 * Способ оплаты доступен покупателю: включён; тестовый — не в production; онлайн — только если платёжный порт
 * реально есть (при порте «none», то есть production без выбранного провайдера, онлайн-оплаты нет).
 */
function paymentUsable(m: PaymentMethodRow, prod: boolean): boolean {
  if (!m.enabled) return false;
  if (prod && m.testOnly) return false;
  if (m.kind === 'online' && getPaymentPort({ production: prod }).name === 'none') return false;
  return true;
}

function ownedCart(db: Db, cartId: number, owner: OwnerRef): CartRow {
  const c = cartsRepo.findById(db, cartId);
  const mine =
    c && (owner.kind === 'user' ? c.userId === owner.userId : c.guestId !== null && c.guestId === owner.guestId);
  if (!c || !mine) throw new NotFoundError('Корзина не найдена');
  return c;
}

function sameOwner(order: { userId: number | null; guestId: string | null }, owner: OwnerRef): boolean {
  return owner.kind === 'user' ? order.userId === owner.userId : order.guestId !== null && order.guestId === owner.guestId;
}

export const checkout = {
  /** Способы получения и оплаты, доступные сейчас: включённые; тестовые оплаты — не в production. */
  methods(opts: CheckoutOpts = {}): { delivery: DeliveryMethodRow[]; payment: PaymentMethodRow[] } {
    const db = opts.db ?? getDb();
    const prod = isProduction(opts);
    return {
      delivery: methodsRepo.listDelivery(db, { enabledOnly: true }),
      payment: methodsRepo.listPayment(db, { enabledOnly: true }).filter((m) => paymentUsable(m, prod)),
    };
  },

  /**
   * Серверный пересчёт перед оформлением. ok:true — можно оформлять, priced — серверные суммы;
   * ok:false — список изменений цены/наличия/промокода (после «Подтвердить» — cart.acknowledgeChanges).
   */
  async validate(
    cartId: number | null,
    owner: OwnerRef,
    opts: CheckoutOpts = {},
  ): Promise<{ ok: true; priced: ValidatedCart } | { ok: false; changes: Change[] }> {
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    if (cartId === null) throw new ValidationError('Корзина пуста');
    const computed = computeCart(db, ownedCart(db, cartId, owner), now);
    if (computed.items.length === 0) throw new ValidationError('Корзина пуста');
    if (computed.changes.length > 0) return { ok: false, changes: computed.changes };
    return {
      ok: true,
      priced: { ...computed.priced, discount: computed.discount, totalKopecks: computed.priced.subtotal - computed.discount, view: computed.view },
    };
  },

  /**
   * Создаёт заказ. Всё считается на сервере по БД; цены, суммы и позиции из запроса не читаются.
   * Идемпотентно по idempotencyKey (UNIQUE): повтор возвращает тот же заказ. В одной транзакции:
   * пересчёт → способы → заказ и строки (снимок) → событие → согласие → расход промокода → очистка корзины.
   */
  async place(rawInput: unknown, opts: CheckoutOpts = {}): Promise<Order> {
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    assertPricesShown({ db, now }); // «Показывать цены» выключен: оформление недоступно на сервере
    const owner = (rawInput as { owner?: OwnerRef } | null)?.owner;
    if (!owner || (owner.kind !== 'user' && owner.kind !== 'guest')) throw new ValidationError('Не определён владелец корзины');
    if (owner.kind === 'user' && usersRepo.findById(db, owner.userId)?.status === 'blocked') {
      throw new ForbiddenError('Оформление заказа недоступно: аккаунт заблокирован. Свяжитесь с магазином');
    }
    const input = parsePlaceInput(rawInput);
    const prod = isProduction(opts);

    const result = withTransaction(db, () => {
      const existing = ordersRepo.findByIdempotencyKey(db, input.idempotencyKey);
      if (existing) {
        if (!sameOwner(existing, owner)) throw new ConflictError('Этот ключ запроса уже использован');
        return { order: toOrder(db, existing), created: false };
      }

      const c = ownedCart(db, input.cartId, owner);
      const computed = computeCart(db, c, now);
      if (computed.items.length === 0) throw new ValidationError('Корзина пуста');
      if (computed.changes.length > 0) throw new CheckoutChangesError(computed.changes);

      const delivery = methodsRepo.findDelivery(db, input.deliveryMethodId);
      if (!delivery || !delivery.enabled) {
        throw new ValidationError('Выбранный способ получения недоступен', { deliveryMethodId: ['Выберите доступный способ получения'] });
      }
      const payment = methodsRepo.findPayment(db, input.paymentMethodId);
      if (!payment || !paymentUsable(payment, prod)) {
        throw new ValidationError('Выбранный способ оплаты недоступен', { paymentMethodId: ['Выберите доступный способ оплаты'] });
      }
      const address = input.contact.address ?? null;
      if (delivery.requiresAddress && (address === null || address.length < 5)) {
        throw new ValidationError('Укажите адрес доставки', { 'contact.address': ['Укажите адрес доставки'] });
      }

      // C12: стоимость доставки, порог бесплатной, минимальная сумма и география — по настройкам, на сервере.
      const subtotal = computed.priced.subtotal;
      const discount = computed.discount;
      const quote = quoteDelivery(delivery, subtotal - discount, address);
      if (!quote.ok) throw new ValidationError(quote.message, { deliveryMethodId: [quote.message] });
      const deliveryKopecks = quote.priceKopecks;
      const limitProblem = paymentLimitProblem(payment, subtotal - discount + (deliveryKopecks ?? 0));
      if (limitProblem) throw new ValidationError(limitProblem, { paymentMethodId: [limitProblem] });
      const rules = chargeRulesFor(db, payment);
      const charges = orderCharges({ lines: computed.items.map((i) => i.unit * i.row.qty), discountKopecks: discount, deliveryKopecks, rules });

      if (computed.promo) {
        if (!promosRepo.tryConsume(db, computed.promo.id)) {
          throw new CheckoutChangesError([
            { kind: 'promo_invalid', code: computed.promo.code, message: 'Промокод уже использован максимальное число раз.' },
          ]);
        }
      }

      const total = charges.totalKopecks;

      const { id } = ordersRepo.insert(db, {
        owner,
        status: payment.kind === 'online' ? 'awaiting_payment' : 'new',
        contactName: input.contact.name,
        contactEmail: input.contact.email,
        contactPhone: input.contact.phone,
        phoneDigits: phoneDigits(input.contact.phone),
        comment: input.contact.comment ?? null,
        address,
        delivery: { id: delivery.id, code: delivery.code, name: delivery.name, kind: delivery.kind, kopecks: deliveryKopecks },
        payment: { id: payment.id, code: payment.code, name: payment.name, kind: payment.kind },
        subtotalKopecks: subtotal,
        discountKopecks: discount,
        totalKopecks: total,
        charges: { paymentFeeKopecks: charges.feeKopecks, taxKopecks: charges.taxKopecks, taxMode: charges.taxMode, chargesJson: serializeRules(rules) },
        promo: computed.promo ? { id: computed.promo.id, code: computed.promo.code } : null,
        idempotencyKey: input.idempotencyKey,
        now,
      });

      computed.items.forEach((i, idx) => {
        ordersRepo.insertItemWithTax(db, id, {
          productId: i.row.productId,
          name: i.row.product.name,
          sku: i.row.product.sku,
          priceKopecks: i.row.product.priceKopecks,
          discountPriceKopecks: i.original !== null ? i.unit : null,
          unitKopecks: i.unit,
          qty: i.row.qty,
          lineKopecks: i.unit * i.row.qty,
          taxRateBp: rules.tax?.rateBp ?? null,
          taxKopecks: rules.tax ? (charges.lineTaxKopecks[idx] ?? 0) : null,
        });
      });
      // C04 (ADR-014): резерв остатка для товаров с включённым учётом; не хватает — оформление отклоняется
      stock.reserveForOrder(
        id,
        computed.items.map((i) => ({ productId: i.row.productId, qty: i.row.qty })),
        { db, now },
      );
      ordersRepo.insertEvent(db, {
        orderId: id,
        at: now,
        kind: 'created',
        toStatus: payment.kind === 'online' ? 'awaiting_payment' : 'new',
        actorType: 'customer',
        actorId: owner.kind === 'user' ? String(owner.userId) : null,
      });
      consent.record(
        {
          kind: 'privacy',
          source: 'checkout',
          userId: owner.kind === 'user' ? owner.userId : null,
          guestId: owner.kind === 'guest' ? owner.guestId : null,
          subject: input.contact.email,
        },
        { db, now },
      );
      audit.record(
        {
          actorId: owner.kind === 'user' ? owner.userId : null,
          actorType: owner.kind === 'user' ? 'user' : 'system',
          action: 'order.create',
          entity: 'order',
          entityId: id,
          after: { total, items: computed.items.length, promo: computed.promo?.code },
        },
        { db, now },
      );
      cartApi.clear(owner, { db, now });
      return { order: toOrder(db, ordersRepo.findById(db, id)!), created: true };
    });

    if (result.created) {
      const o = result.order;
      // C10: уведомление сотрудникам о новом заказе (колокольчик админки); сбой уведомления не должен ронять оформление
      try {
        notify(
          { type: 'order.created', title: `Новый заказ ${o.number}`, href: `/admin/orders/${encodeURIComponent(o.number)}`, entity: 'order', entityId: o.number, audience: 'permission:orders.read' },
          { db, now },
        );
      } catch {
        /* уведомление вторично */
      }
      enqueueMail(
        'order.created',
        {
          to: o.contact.email,
          name: o.contact.name,
          orderNumber: o.number,
          status: o.status,
          subtotalKopecks: o.subtotalKopecks,
          discountKopecks: o.discountKopecks,
          deliveryName: o.delivery.name,
          deliveryPending: o.delivery.pending,
          deliveryKopecks: o.deliveryKopecks,
          paymentName: o.payment.name,
          totalKopecks: o.totalKopecks,
          items: o.items.map((i) => ({ name: i.name, sku: i.sku, qty: i.qty, unitKopecks: i.unitKopecks, lineKopecks: i.lineKopecks })),
          orderUrl: orderUrlFor(o, opts),
        },
        { db, now },
      );
    }
    return result.order;
  },
};
