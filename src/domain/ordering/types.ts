import type { Db } from '@/server/db/connection';
import type { EventActorType, OrderStatus } from '@/server/db/repositories/orders';
import type { StaffRole } from '@/server/db/repositories/staff';
import type { OwnerRef } from '@/server/http/owner';

export type { OrderStatus, OwnerRef };

/** Общие опции доменных функций: БД и время подменяются в тестах. */
export type Opts = { db?: Db; now?: number; secret?: string; /** Только orders.refund: возврат у провайдера уже проведён. */ viaRefund?: boolean; /** Только orders.refund: другой возвратчик вместо зарегистрированного (подбор зависших возвратов). */ refunder?: (order: Order, ctx: { idempotencyKey: string }) => Promise<void> };

/** Кто меняет заказ. system — проверенный webhook, импорт; staff — сотрудник; customer — сам покупатель. */
export type Actor =
  | { type: 'staff'; staffId: number; role: StaffRole; permissions?: readonly string[] }
  | { type: 'system'; reason?: string }
  | { type: 'customer'; owner: OwnerRef };

export const actorEventType = (a: Actor): EventActorType => a.type;

export type OrderItem = {
  id: number;
  productId: number | null;
  name: string;
  sku: string | null;
  /** Розничная цена на момент покупки. */
  priceKopecks: number;
  /** Скидочная цена, если действовала. */
  discountPriceKopecks: number | null;
  /** Цена, по которой куплено. */
  unitKopecks: number;
  qty: number;
  lineKopecks: number;
};

export type OrderEvent = {
  id: number;
  at: number;
  kind: 'created' | 'status' | 'note' | 'assigned';
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  actorType: EventActorType;
  actorId: string | null;
  note: string | null;
};

export type Order = {
  id: number;
  /** RTS-000123 */
  number: string;
  status: OrderStatus;
  isPaid: boolean;
  owner: OwnerRef;
  contact: { name: string; email: string; phone: string; comment: string | null; address: string | null };
  delivery: { code: string; name: string; kind: string; priceKopecks: number | null; pending: boolean };
  payment: { code: string; name: string; kind: string };
  items: OrderItem[];
  subtotalKopecks: number;
  discountKopecks: number;
  /** Стоимость доставки; 0, пока её рассчитывает менеджер (delivery.pending). */
  deliveryKopecks: number;
  /** Товары − скидка + известная доставка. */
  totalKopecks: number;
  promoCode: string | null;
  assignedStaffId: number | null;
  createdAt: number;
  updatedAt: number;
};

/** Корзина для показа и пересчёта. Все суммы — копейки, посчитаны на сервере. */
export type CartLine = {
  productId: number;
  slug: string;
  name: string;
  sku: string | null;
  qty: number;
  unitKopecks: number;
  originalKopecks: number | null;
  lineKopecks: number;
  available: boolean;
  imageUrl: string | null;
};

export type CartView = {
  cartId: number | null;
  items: CartLine[];
  /** Сумма единиц (для счётчика в шапке). */
  count: number;
  subtotalKopecks: number;
  discountKopecks: number;
  /** Товары − скидка (доставка добавляется при оформлении). */
  totalKopecks: number;
  promo: { code: string; discountKopecks: number } | null;
  /** Текст, если сохранённый промокод больше не действует. */
  promoError: string | null;
  /** Пояснение к последнему действию (например, «количество ограничено 20»). */
  notice?: string;
};

export type Change =
  | { kind: 'price_changed'; productId: number; name: string; oldUnitKopecks: number; newUnitKopecks: number }
  | { kind: 'unavailable'; productId: number; name: string; reason: 'out_of_stock' | 'unpublished' }
  | { kind: 'promo_invalid'; code: string; message: string };

export const MAX_QTY = 20;
