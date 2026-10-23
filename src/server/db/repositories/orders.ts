import type { OwnerRef } from '../../http/owner';
import type { Db } from '../connection';

export const ORDER_STATUSES = [
  'new',
  'awaiting_payment',
  'paid',
  'processing',
  'shipped',
  'ready_for_pickup',
  'delivered',
  'cancelled',
  'payment_failed',
  'refunded',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderRow = {
  id: number;
  number: string;
  userId: number | null;
  guestId: string | null;
  status: OrderStatus;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  comment: string | null;
  address: string | null;
  deliveryMethodId: number | null;
  deliveryCode: string;
  deliveryName: string;
  deliveryKind: string;
  /** null — стоимость доставки рассчитает менеджер. */
  deliveryKopecks: number | null;
  paymentMethodId: number | null;
  paymentCode: string;
  paymentName: string;
  paymentKind: string;
  subtotalKopecks: number;
  discountKopecks: number;
  totalKopecks: number;
  promoId: number | null;
  promoCode: string | null;
  isPaid: boolean;
  assignedStaffId: number | null;
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
};

export type OrderItemRow = {
  id: number;
  orderId: number;
  productId: number | null;
  name: string;
  sku: string | null;
  priceKopecks: number;
  discountPriceKopecks: number | null;
  unitKopecks: number;
  qty: number;
  lineKopecks: number;
};

export type OrderEventKind = 'created' | 'status' | 'note' | 'assigned';
export type EventActorType = 'customer' | 'staff' | 'system';
export type OrderEventRow = {
  id: number;
  orderId: number;
  at: number;
  kind: OrderEventKind;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  actorType: EventActorType;
  actorId: string | null;
  note: string | null;
};

type Raw = Record<string, unknown> & {
  id: number;
  number: string | null;
  user_id: number | null;
  guest_id: string | null;
  status: OrderStatus;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  comment: string | null;
  address: string | null;
  delivery_method_id: number | null;
  delivery_code: string;
  delivery_name: string;
  delivery_kind: string;
  delivery_kopecks: number | null;
  payment_method_id: number | null;
  payment_code: string;
  payment_name: string;
  payment_kind: string;
  subtotal_kopecks: number;
  discount_kopecks: number;
  total_kopecks: number;
  promo_id: number | null;
  promo_code: string | null;
  is_paid: number;
  assigned_staff_id: number | null;
  idempotency_key: string;
  created_at: number;
  updated_at: number;
};

const mapOrder = (r: Raw | undefined): OrderRow | null =>
  r
    ? {
        id: r.id,
        number: r.number ?? '',
        userId: r.user_id,
        guestId: r.guest_id,
        status: r.status,
        contactName: r.contact_name,
        contactEmail: r.contact_email,
        contactPhone: r.contact_phone,
        comment: r.comment,
        address: r.address,
        deliveryMethodId: r.delivery_method_id,
        deliveryCode: r.delivery_code,
        deliveryName: r.delivery_name,
        deliveryKind: r.delivery_kind,
        deliveryKopecks: r.delivery_kopecks,
        paymentMethodId: r.payment_method_id,
        paymentCode: r.payment_code,
        paymentName: r.payment_name,
        paymentKind: r.payment_kind,
        subtotalKopecks: r.subtotal_kopecks,
        discountKopecks: r.discount_kopecks,
        totalKopecks: r.total_kopecks,
        promoId: r.promo_id,
        promoCode: r.promo_code,
        isPaid: r.is_paid === 1,
        assignedStaffId: r.assigned_staff_id,
        idempotencyKey: r.idempotency_key,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }
    : null;

export type NewOrder = {
  owner: OwnerRef;
  status: OrderStatus;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  phoneDigits: string;
  comment: string | null;
  address: string | null;
  delivery: { id: number; code: string; name: string; kind: string; kopecks: number | null };
  payment: { id: number; code: string; name: string; kind: string };
  subtotalKopecks: number;
  discountKopecks: number;
  totalKopecks: number;
  promo: { id: number; code: string } | null;
  idempotencyKey: string;
  now: number;
};

export type NewOrderItem = {
  productId: number;
  name: string;
  sku: string | null;
  priceKopecks: number;
  discountPriceKopecks: number | null;
  unitKopecks: number;
  qty: number;
  lineKopecks: number;
};

export type OrderListFilter = {
  /** Поиск по номеру, email, телефону, имени. */
  q?: string;
  status?: OrderStatus;
  /** Границы по created_at, unix-мс; to — не включая. */
  from?: number;
  to?: number;
  assignedStaffId?: number | 'none';
  limit?: number;
  offset?: number;
};

export const formatOrderNumber = (id: number): string => `RTS-${String(id).padStart(6, '0')}`;

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const ordersRepo = {
  /**
   * Вставляет заказ и присваивает номер RTS-NNNNNN (по id). Нарушение UNIQUE(idempotency_key)
   * бросает ошибку SQLite — сервис ловит её и возвращает уже созданный заказ.
   * Вызывать внутри транзакции.
   */
  insert(db: Db, o: NewOrder): { id: number; number: string } {
    const r = db
      .prepare(
        `INSERT INTO orders (number, user_id, guest_id, status, contact_name, contact_name_lc, contact_email, contact_phone, phone_digits,
           comment, address, delivery_method_id, delivery_code, delivery_name, delivery_kind, delivery_kopecks,
           payment_method_id, payment_code, payment_name, payment_kind,
           subtotal_kopecks, discount_kopecks, total_kopecks, promo_id, promo_code, is_paid, idempotency_key, created_at, updated_at)
         VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(
        o.owner.kind === 'user' ? o.owner.userId : null,
        o.owner.kind === 'guest' ? o.owner.guestId : null,
        o.status,
        o.contactName,
        o.contactName.toLowerCase(),
        o.contactEmail,
        o.contactPhone,
        o.phoneDigits,
        o.comment,
        o.address,
        o.delivery.id,
        o.delivery.code,
        o.delivery.name,
        o.delivery.kind,
        o.delivery.kopecks,
        o.payment.id,
        o.payment.code,
        o.payment.name,
        o.payment.kind,
        o.subtotalKopecks,
        o.discountKopecks,
        o.totalKopecks,
        o.promo?.id ?? null,
        o.promo?.code ?? null,
        o.idempotencyKey,
        o.now,
        o.now,
      );
    const id = Number(r.lastInsertRowid);
    const number = formatOrderNumber(id);
    db.prepare('UPDATE orders SET number = ? WHERE id = ?').run(number, id);
    return { id, number };
  },
  insertItem(db: Db, orderId: number, i: NewOrderItem): void {
    db.prepare(
      `INSERT INTO order_items (order_id, product_id, name, sku, price_kopecks, discount_price_kopecks, unit_kopecks, qty, line_kopecks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(orderId, i.productId, i.name, i.sku, i.priceKopecks, i.discountPriceKopecks, i.unitKopecks, i.qty, i.lineKopecks);
  },
  insertEvent(
    db: Db,
    e: { orderId: number; at: number; kind: OrderEventKind; fromStatus?: OrderStatus | null; toStatus?: OrderStatus | null; actorType: EventActorType; actorId?: string | null; note?: string | null },
  ): number {
    const r = db
      .prepare('INSERT INTO order_events (order_id, at, kind, from_status, to_status, actor_type, actor_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(e.orderId, e.at, e.kind, e.fromStatus ?? null, e.toStatus ?? null, e.actorType, e.actorId ?? null, e.note ?? null);
    return Number(r.lastInsertRowid);
  },
  findById(db: Db, id: number): OrderRow | null {
    return mapOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Raw | undefined);
  },
  findByNumber(db: Db, number: string): OrderRow | null {
    return mapOrder(db.prepare('SELECT * FROM orders WHERE number = ?').get(number) as Raw | undefined);
  },
  findByIdempotencyKey(db: Db, key: string): OrderRow | null {
    return mapOrder(db.prepare('SELECT * FROM orders WHERE idempotency_key = ?').get(key) as Raw | undefined);
  },
  listItems(db: Db, orderId: number): OrderItemRow[] {
    const rows = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as number,
      orderId: r.order_id as number,
      productId: (r.product_id as number | null) ?? null,
      name: r.name as string,
      sku: (r.sku as string | null) ?? null,
      priceKopecks: r.price_kopecks as number,
      discountPriceKopecks: (r.discount_price_kopecks as number | null) ?? null,
      unitKopecks: r.unit_kopecks as number,
      qty: r.qty as number,
      lineKopecks: r.line_kopecks as number,
    }));
  },
  listEvents(db: Db, orderId: number): OrderEventRow[] {
    const rows = db.prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY id').all(orderId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as number,
      orderId: r.order_id as number,
      at: r.at as number,
      kind: r.kind as OrderEventKind,
      fromStatus: (r.from_status as OrderStatus | null) ?? null,
      toStatus: (r.to_status as OrderStatus | null) ?? null,
      actorType: r.actor_type as EventActorType,
      actorId: (r.actor_id as string | null) ?? null,
      note: (r.note as string | null) ?? null,
    }));
  },
  /** Смена статуса. paid: true/false меняет флаг оплаты, undefined — оставляет. */
  setStatus(db: Db, id: number, status: OrderStatus, now: number, paid?: boolean): void {
    if (paid === undefined) db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
    else db.prepare('UPDATE orders SET status = ?, is_paid = ?, updated_at = ? WHERE id = ?').run(status, paid ? 1 : 0, now, id);
  },
  /**
   * Помечает использование промокода заказа возвращённым. true — пометка поставлена сейчас (возвращать счётчик),
   * false — заказ без промокода или уже возвращён. Вызывать внутри транзакции вместе с promosRepo.release.
   */
  markPromoReleased(db: Db, id: number): number | null {
    const row = db
      .prepare('UPDATE orders SET promo_released = 1 WHERE id = ? AND promo_id IS NOT NULL AND promo_released = 0 RETURNING promo_id')
      .get(id) as { promo_id: number } | undefined;
    return row ? row.promo_id : null;
  },
  setAssigned(db: Db, id: number, staffId: number | null, now: number): void {
    db.prepare('UPDATE orders SET assigned_staff_id = ?, updated_at = ? WHERE id = ?').run(staffId, now, id);
  },
  listForOwner(db: Db, owner: OwnerRef): OrderRow[] {
    const rows =
      owner.kind === 'user'
        ? db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(owner.userId)
        : db.prepare('SELECT * FROM orders WHERE guest_id = ? ORDER BY id DESC').all(owner.guestId);
    return (rows as Raw[]).map((r) => mapOrder(r)!);
  },
  list(db: Db, f: OrderListFilter = {}): { rows: OrderRow[]; total: number } {
    const where: string[] = [];
    const args: Array<string | number> = [];
    const q = (f.q ?? '').trim();
    if (q) {
      const like = `%${escapeLike(q.toLowerCase())}%`;
      const rawDigits = q.replace(/\D/g, '');
      // 8XXXXXXXXXX → 7XXXXXXXXXX, как при сохранении телефона
      const digits = rawDigits.length === 11 && rawDigits.startsWith('8') ? `7${rawDigits.slice(1)}` : rawDigits;
      const parts = [
        String.raw`lower(number) LIKE ? ESCAPE '\'`,
        String.raw`contact_email LIKE ? ESCAPE '\'`,
        String.raw`contact_name_lc LIKE ? ESCAPE '\'`,
      ];
      args.push(like, like, like);
      if (digits.length >= 3) {
        parts.push('phone_digits LIKE ?');
        args.push(`%${digits}%`);
      }
      // «123», «000123», «RTS-000123» — номер заказа целиком
      const num = /^(?:rts-?)?(\d{1,9})$/i.exec(q);
      if (num) {
        parts.push('id = ?');
        args.push(Number(num[1]));
      }
      where.push(`(${parts.join(' OR ')})`);
    }
    if (f.status) {
      where.push('status = ?');
      args.push(f.status);
    }
    if (f.from !== undefined) {
      where.push('created_at >= ?');
      args.push(f.from);
    }
    if (f.to !== undefined) {
      where.push('created_at < ?');
      args.push(f.to);
    }
    if (f.assignedStaffId === 'none') where.push('assigned_staff_id IS NULL');
    else if (typeof f.assignedStaffId === 'number') {
      where.push('assigned_staff_id = ?');
      args.push(f.assignedStaffId);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM orders ${w}`).get(...args) as { c: number }).c;
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
    const rows = db
      .prepare(`SELECT * FROM orders ${w} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...args, limit, Math.max(f.offset ?? 0, 0)) as Raw[];
    return { rows: rows.map((r) => mapOrder(r)!), total };
  },
  count(db: Db): number {
    return (db.prepare('SELECT COUNT(*) AS c FROM orders').get() as { c: number }).c;
  },
};
