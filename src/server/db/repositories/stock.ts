import type { Db } from '../connection';

export const AVAILABILITY_VALUES = ['in_stock', 'out_of_stock', 'preorder', 'discontinued'] as const;
export type Availability = (typeof AVAILABILITY_VALUES)[number];

/** Продаётся ли товар в этом статусе (зеркало в products.in_stock). */
export const isSellable = (a: Availability): boolean => a === 'in_stock' || a === 'preorder';

export type StockRow = {
  id: number;
  name: string;
  stockQty: number;
  reservedQty: number;
  tracked: boolean;
  availability: Availability;
  availabilityManual: boolean;
  inStock: boolean;
  lockedFields: string[];
};

export type StockMovementRow = {
  id: number;
  productId: number;
  delta: number;
  qtyAfter: number;
  reservedDelta: number;
  reservedAfter: number;
  reason: string;
  ref: string | null;
  staffId: number | null;
  createdAt: string;
};

export type NewStockMovement = Omit<StockMovementRow, 'id'>;

type Raw = {
  id: number;
  name: string;
  stock_qty: number;
  reserved_qty: number;
  stock_tracked: number;
  availability: string;
  availability_manual: number;
  in_stock: number;
  locked_fields: string;
};

type MoveRaw = {
  id: number;
  product_id: number;
  delta: number;
  qty_after: number;
  reserved_delta: number;
  reserved_after: number;
  reason: string;
  ref: string | null;
  staff_id: number | null;
  created_at: string;
};

const parseLocked = (json: string): string[] => {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const asAvailability = (v: string): Availability => ((AVAILABILITY_VALUES as readonly string[]).includes(v) ? (v as Availability) : 'in_stock');

export const stockRepo = {
  get(db: Db, productId: number): StockRow | undefined {
    const r = db
      .prepare('SELECT id, name, stock_qty, reserved_qty, stock_tracked, availability, availability_manual, in_stock, locked_fields FROM products WHERE id = ?')
      .get(productId) as Raw | undefined;
    if (!r) return undefined;
    return {
      id: r.id,
      name: r.name,
      stockQty: r.stock_qty,
      reservedQty: r.reserved_qty,
      tracked: r.stock_tracked === 1,
      availability: asAvailability(r.availability),
      availabilityManual: r.availability_manual === 1,
      inStock: r.in_stock === 1,
      lockedFields: parseLocked(r.locked_fields),
    };
  },

  /** Записывает остаток, резерв и итоговое наличие (учёт при этом включается). Закрепляет in_stock за ручной правкой. */
  save(db: Db, id: number, s: { stockQty: number; reservedQty: number; availability: Availability; lockedFields: string[]; now: string }): void {
    db.prepare(
      `UPDATE products SET stock_qty = ?, reserved_qty = ?, stock_tracked = 1, availability = ?, in_stock = ?, locked_fields = ?, updated_at = ? WHERE id = ?`,
    ).run(s.stockQty, s.reservedQty, s.availability, isSellable(s.availability) ? 1 : 0, JSON.stringify(s.lockedFields), s.now, id);
  },

  /** Только наличие (без остатка): для ручного статуса и возврата на «авто». */
  saveAvailability(db: Db, id: number, a: { availability: Availability; manual: boolean }): void {
    db.prepare('UPDATE products SET availability = ?, availability_manual = ?, in_stock = ? WHERE id = ?').run(a.availability, a.manual ? 1 : 0, isSellable(a.availability) ? 1 : 0, id);
  },

  insertMovement(db: Db, m: NewStockMovement): number {
    const r = db
      .prepare(
        `INSERT INTO stock_movements (product_id, delta, qty_after, reserved_delta, reserved_after, reason, ref, staff_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(m.productId, m.delta, m.qtyAfter, m.reservedDelta, m.reservedAfter, m.reason, m.ref, m.staffId, m.createdAt);
    return Number(r.lastInsertRowid);
  },

  /** История операций, новые сверху. */
  listMovements(db: Db, productId: number, limit: number): StockMovementRow[] {
    const rows = db
      .prepare(
        `SELECT id, product_id, delta, qty_after, reserved_delta, reserved_after, reason, ref, staff_id, created_at
         FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(productId, limit) as MoveRaw[];
    return rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      delta: r.delta,
      qtyAfter: r.qty_after,
      reservedDelta: r.reserved_delta,
      reservedAfter: r.reserved_after,
      reason: r.reason,
      ref: r.ref,
      staffId: r.staff_id,
      createdAt: r.created_at,
    }));
  },

  /** Сколько по ссылке (заказу) сейчас числится в резерве по каждому товару: сумма reserved_delta. */
  netReservedByRef(db: Db, ref: string): { productId: number; net: number }[] {
    return (db.prepare('SELECT product_id, SUM(reserved_delta) AS net FROM stock_movements WHERE ref = ? GROUP BY product_id').all(ref) as { product_id: number; net: number }[]).map((r) => ({
      productId: r.product_id,
      net: Number(r.net),
    }));
  },

  /** Есть ли по ссылке хоть одна операция с товаром (повторный резерв того же заказа пропускается). */
  hasRefMovement(db: Db, ref: string, productId: number): boolean {
    return db.prepare('SELECT 1 AS x FROM stock_movements WHERE ref = ? AND product_id = ? LIMIT 1').get(ref, productId) !== undefined;
  },
};
