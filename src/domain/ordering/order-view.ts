import type { Db } from '@/server/db/connection';
import { ordersRepo, type OrderRow } from '@/server/db/repositories/orders';
import type { Order } from './types';

/** Строка заказа БД → доменный Order (со строками состава). */
export function toOrder(db: Db, row: OrderRow): Order {
  const items = ordersRepo.listItems(db, row.id);
  const deliveryKopecks = row.deliveryKopecks ?? 0;
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    isPaid: row.isPaid,
    owner: row.userId !== null ? { kind: 'user', userId: row.userId } : { kind: 'guest', guestId: row.guestId ?? '' },
    contact: { name: row.contactName, email: row.contactEmail, phone: row.contactPhone, comment: row.comment, address: row.address },
    delivery: {
      code: row.deliveryCode,
      name: row.deliveryName,
      kind: row.deliveryKind,
      priceKopecks: row.deliveryKopecks,
      pending: row.deliveryKopecks === null,
    },
    payment: { code: row.paymentCode, name: row.paymentName, kind: row.paymentKind },
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      name: i.name,
      sku: i.sku,
      priceKopecks: i.priceKopecks,
      discountPriceKopecks: i.discountPriceKopecks,
      unitKopecks: i.unitKopecks,
      qty: i.qty,
      lineKopecks: i.lineKopecks,
    })),
    subtotalKopecks: row.subtotalKopecks,
    discountKopecks: row.discountKopecks,
    deliveryKopecks,
    totalKopecks: row.totalKopecks,
    promoCode: row.promoCode,
    assignedStaffId: row.assignedStaffId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
