import type { Db } from '../connection';
import { ensureLowerFn } from './content-base';

export type WarehouseRow = {
  id: number;
  name: string;
  address: string | null;
  active: boolean;
  isDefault: boolean;
  sort: number;
  createdAt: number;
};

type RawW = { id: number; name: string; address: string | null; active: number; is_default: number; sort: number; created_at: number };
const mapW = (r: RawW): WarehouseRow => ({ id: r.id, name: r.name, address: r.address, active: r.active === 1, isDefault: r.is_default === 1, sort: r.sort, createdAt: r.created_at });

export type WarehouseStockRow = { productId: number; warehouseId: number; qty: number; reserved: number };

export type WarehouseWrite = { name: string; address: string | null; active: boolean; sort: number };

export type StockTableFilter = {
  q?: string;
  warehouseId?: number;
  /** tracked — только с учётом (по умолчанию), untracked — без учёта, all — все. */
  tracking?: 'tracked' | 'untracked' | 'all';
  /** Свободный остаток не больше порога. */
  lowThreshold?: number;
  limit: number;
  offset: number;
};

export type StockTableRow = {
  productId: number;
  name: string;
  sku: string | null;
  tracked: boolean;
  stockQty: number;
  reservedQty: number;
  inStock: boolean;
  parts: { warehouseId: number; qty: number; reserved: number }[];
};

export type MovementFilter = {
  q?: string;
  warehouseId?: number;
  kind?: MovementKind;
  /** ISO-время включительно / не включая. */
  from?: string;
  to?: string;
  productId?: number;
  limit: number;
  offset: number;
};

export const MOVEMENT_KINDS = ['receipt', 'writeoff', 'transfer', 'reserve', 'release', 'order_writeoff'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export type MovementListRow = {
  id: number;
  productId: number;
  productName: string;
  sku: string | null;
  warehouseId: number | null;
  warehouseName: string | null;
  toWarehouseId: number | null;
  toWarehouseName: string | null;
  movedQty: number | null;
  delta: number;
  qtyAfter: number;
  reservedDelta: number;
  reservedAfter: number;
  reason: string;
  ref: string | null;
  staffName: string | null;
  createdAt: string;
};

export type ReserveRow = { ref: string; orderNumber: string | null; orderStatus: string | null; productId: number; productName: string; sku: string | null; qty: number };

const KIND_SQL: Record<MovementKind, string> = {
  receipt: 'm.moved_qty IS NULL AND m.delta > 0 AND m.reserved_delta = 0',
  writeoff: 'm.moved_qty IS NULL AND m.delta < 0 AND m.reserved_delta = 0',
  transfer: 'm.moved_qty IS NOT NULL',
  reserve: 'm.reserved_delta > 0',
  release: 'm.reserved_delta < 0 AND m.delta = 0',
  order_writeoff: 'm.reserved_delta < 0 AND m.delta < 0',
};

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

type Row = { warehouse_id: number; qty: number; reserved: number };

export class StockInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockInvariantError';
  }
}

export const warehousesRepo = {
  list(db: Db): WarehouseRow[] {
    return (db.prepare('SELECT * FROM warehouses ORDER BY is_default DESC, sort, id').all() as RawW[]).map(mapW);
  },
  find(db: Db, id: number): WarehouseRow | null {
    const r = db.prepare('SELECT * FROM warehouses WHERE id = ?').get(id) as RawW | undefined;
    return r ? mapW(r) : null;
  },
  defaultId(db: Db): number | null {
    const r = db.prepare('SELECT id FROM warehouses WHERE is_default = 1').get() as { id: number } | undefined;
    return r?.id ?? null;
  },
  insert(db: Db, w: WarehouseWrite, now: number): number {
    return Number(db.prepare('INSERT INTO warehouses (name, address, active, is_default, sort, created_at) VALUES (?, ?, ?, 0, ?, ?)').run(w.name, w.address, w.active ? 1 : 0, w.sort, now).lastInsertRowid);
  },
  update(db: Db, id: number, w: WarehouseWrite): boolean {
    return Number(db.prepare('UPDATE warehouses SET name = ?, address = ?, active = ?, sort = ? WHERE id = ?').run(w.name, w.address, w.active ? 1 : 0, w.sort, id).changes) > 0;
  },
  setDefault(db: Db, id: number): void {
    db.prepare('UPDATE warehouses SET is_default = 0 WHERE is_default = 1').run();
    db.prepare('UPDATE warehouses SET is_default = 1 WHERE id = ?').run(id);
  },
  /** Сколько единиц и резерва лежит на складе. */
  totals(db: Db, warehouseId: number): { qty: number; reserved: number; products: number } {
    const r = db.prepare('SELECT COALESCE(SUM(qty), 0) AS q, COALESCE(SUM(reserved), 0) AS r, COUNT(*) AS n FROM stock_by_warehouse WHERE warehouse_id = ? AND (qty > 0 OR reserved > 0)').get(warehouseId) as { q: number; r: number; n: number };
    return { qty: Number(r.q), reserved: Number(r.r), products: Number(r.n) };
  },
  /** Склад нигде не упоминается в истории — его можно удалить. */
  hasHistory(db: Db, warehouseId: number): boolean {
    return db.prepare('SELECT 1 AS x FROM stock_movements WHERE warehouse_id = ? OR to_warehouse_id = ? LIMIT 1').get(warehouseId, warehouseId) !== undefined;
  },
  delete(db: Db, id: number): void {
    db.prepare('DELETE FROM stock_by_warehouse WHERE warehouse_id = ?').run(id);
    db.prepare('DELETE FROM warehouses WHERE id = ?').run(id);
  },

  // ---- остатки по складам
  rowsFor(db: Db, productId: number): WarehouseStockRow[] {
    return (
      db
        .prepare(
          `SELECT s.product_id, s.warehouse_id, s.qty, s.reserved FROM stock_by_warehouse s JOIN warehouses w ON w.id = s.warehouse_id
           WHERE s.product_id = ? ORDER BY w.is_default DESC, w.active DESC, w.sort, w.id`,
        )
        .all(productId) as { product_id: number; warehouse_id: number; qty: number; reserved: number }[]
    ).map((r) => ({ productId: r.product_id, warehouseId: r.warehouse_id, qty: r.qty, reserved: r.reserved }));
  },
  row(db: Db, productId: number, warehouseId: number): WarehouseStockRow | null {
    const r = db.prepare('SELECT product_id, warehouse_id, qty, reserved FROM stock_by_warehouse WHERE product_id = ? AND warehouse_id = ?').get(productId, warehouseId) as
      | { product_id: number; warehouse_id: number; qty: number; reserved: number }
      | undefined;
    return r ? { productId: r.product_id, warehouseId: r.warehouse_id, qty: r.qty, reserved: r.reserved } : null;
  },
  /** Задаёт qty и reserved одной строки (создаёт её при отсутствии). */
  putRow(db: Db, productId: number, warehouseId: number, qty: number, reserved: number): void {
    db.prepare(
      `INSERT INTO stock_by_warehouse (product_id, warehouse_id, qty, reserved) VALUES (?, ?, ?, ?)
       ON CONFLICT(product_id, warehouse_id) DO UPDATE SET qty = excluded.qty, reserved = excluded.reserved`,
    ).run(productId, warehouseId, qty, reserved);
  },

  /**
   * Приводит остатки по складам к итогам товара (stock_qty = S, reserved_qty = R), которые выставил сервис остатков.
   * Порядок важен из-за CHECK (reserved ≤ qty): сначала уменьшается резерв, потом остаток, потом растёт остаток, потом резерв.
   * Прирост остатка идёт на targetWarehouse (если задан) или на склад по умолчанию; уменьшение — со склада-цели либо
   * со складов по порядку «по умолчанию → активные → прочие», но не глубже свободного остатка.
   */
  reconcile(db: Db, productId: number, stockQty: number, reservedQty: number, targetWarehouseId: number | null = null): void {
    const defaultId = warehousesRepo.defaultId(db);
    if (defaultId === null) return; // склады не заведены (старая схема в тестах) — учёта по складам нет
    const rows = warehousesRepo.rowsFor(db, productId);
    const state = new Map<number, Row>(rows.map((r) => [r.warehouseId, { warehouse_id: r.warehouseId, qty: r.qty, reserved: r.reserved }]));
    const order = rows.map((r) => r.warehouseId);
    const sum = (k: 'qty' | 'reserved') => [...state.values()].reduce((a, r) => a + r[k], 0);
    const flush = (id: number) => {
      const r = state.get(id)!;
      warehousesRepo.putRow(db, productId, id, r.qty, r.reserved);
    };

    // 1. меньше резерва
    let r = sum('reserved');
    if (reservedQty < r) {
      let need = r - reservedQty;
      for (const id of order) {
        const row = state.get(id)!;
        const take = Math.min(need, row.reserved);
        if (take > 0) {
          row.reserved -= take;
          flush(id);
          need -= take;
        }
      }
    }
    // 2. меньше остатка
    const s = sum('qty');
    if (stockQty < s) {
      let need = s - stockQty;
      const ids = targetWarehouseId !== null && state.has(targetWarehouseId) ? [targetWarehouseId] : order;
      for (const id of ids) {
        const row = state.get(id)!;
        const take = Math.min(need, row.qty - row.reserved);
        if (take > 0) {
          row.qty -= take;
          flush(id);
          need -= take;
        }
      }
      if (need > 0) throw new StockInvariantError('Недостаточно свободного остатка на складе для списания');
    }
    // 3. больше остатка
    const s2 = sum('qty');
    if (stockQty > s2) {
      const id = targetWarehouseId ?? defaultId;
      const row = state.get(id) ?? { warehouse_id: id, qty: 0, reserved: 0 };
      row.qty += stockQty - s2;
      state.set(id, row);
      flush(id);
      if (!order.includes(id)) order.push(id);
    }
    // 4. больше резерва
    r = sum('reserved');
    if (reservedQty > r) {
      let need = reservedQty - r;
      for (const id of order) {
        const row = state.get(id)!;
        const take = Math.min(need, row.qty - row.reserved);
        if (take > 0) {
          row.reserved += take;
          flush(id);
          need -= take;
        }
      }
      if (need > 0) throw new StockInvariantError('Резерв не помещается в остатки складов');
    }
  },

  /** Товары, у которых сумма по складам не равна products.stock_qty (должно быть пусто). */
  invariantViolations(db: Db): { productId: number; stockQty: number; reservedQty: number; sumQty: number; sumReserved: number }[] {
    return (
      db
        .prepare(
          `SELECT p.id, p.stock_qty, p.reserved_qty, COALESCE(SUM(s.qty), 0) AS sq, COALESCE(SUM(s.reserved), 0) AS sr
           FROM products p LEFT JOIN stock_by_warehouse s ON s.product_id = p.id
           WHERE p.stock_tracked = 1 GROUP BY p.id HAVING sq <> p.stock_qty OR sr <> p.reserved_qty`,
        )
        .all() as { id: number; stock_qty: number; reserved_qty: number; sq: number; sr: number }[]
    ).map((r) => ({ productId: r.id, stockQty: r.stock_qty, reservedQty: r.reserved_qty, sumQty: Number(r.sq), sumReserved: Number(r.sr) }));
  },

  // ---- таблицы страницы «Склад»
  stockTable(db: Db, f: StockTableFilter): { rows: StockTableRow[]; total: number } {
    const where: string[] = [];
    const args: (string | number)[] = [];
    const tracking = f.tracking ?? 'tracked';
    if (tracking === 'tracked') where.push('p.stock_tracked = 1');
    else if (tracking === 'untracked') where.push('p.stock_tracked = 0');
    if (f.q) {
      ensureLowerFn(db);
      where.push("(rts_lc(p.name) LIKE ? ESCAPE '\\' OR rts_lc(COALESCE(p.sku, '')) LIKE ? ESCAPE '\\')");
      args.push(`%${escapeLike(f.q.toLowerCase())}%`, `%${escapeLike(f.q.toLowerCase())}%`);
    }
    if (f.warehouseId !== undefined) {
      where.push('EXISTS (SELECT 1 FROM stock_by_warehouse s WHERE s.product_id = p.id AND s.warehouse_id = ? AND (s.qty > 0 OR s.reserved > 0))');
      args.push(f.warehouseId);
    }
    if (f.lowThreshold !== undefined) {
      where.push('p.stock_tracked = 1 AND p.stock_qty - p.reserved_qty <= ?');
      args.push(f.lowThreshold);
    }
    const w = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM products p ${w}`).get(...args) as { n: number }).n);
    const raw = db
      .prepare(
        `SELECT p.id, p.name, p.sku, p.stock_tracked, p.stock_qty, p.reserved_qty, p.in_stock,
           (SELECT group_concat(s.warehouse_id || ':' || s.qty || ':' || s.reserved, ',') FROM stock_by_warehouse s WHERE s.product_id = p.id) AS parts
         FROM products p ${w} ORDER BY p.name COLLATE NOCASE, p.id LIMIT ? OFFSET ?`,
      )
      .all(...args, f.limit, f.offset) as { id: number; name: string; sku: string | null; stock_tracked: number; stock_qty: number; reserved_qty: number; in_stock: number; parts: string | null }[];
    return {
      total,
      rows: raw.map((r) => ({
        productId: r.id,
        name: r.name,
        sku: r.sku,
        tracked: r.stock_tracked === 1,
        stockQty: r.stock_qty,
        reservedQty: r.reserved_qty,
        inStock: r.in_stock === 1,
        parts: (r.parts ?? '')
          .split(',')
          .filter(Boolean)
          .map((p) => {
            const [wid, qty, reserved] = p.split(':').map(Number);
            return { warehouseId: wid as number, qty: qty as number, reserved: reserved as number };
          }),
      })),
    };
  },

  movements(db: Db, f: MovementFilter): { rows: MovementListRow[]; total: number } {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (f.q) {
      ensureLowerFn(db);
      where.push("(rts_lc(p.name) LIKE ? ESCAPE '\\' OR rts_lc(COALESCE(p.sku, '')) LIKE ? ESCAPE '\\' OR rts_lc(m.reason) LIKE ? ESCAPE '\\')");
      const like = `%${escapeLike(f.q.toLowerCase())}%`;
      args.push(like, like, like);
    }
    if (f.productId !== undefined) {
      where.push('m.product_id = ?');
      args.push(f.productId);
    }
    if (f.warehouseId !== undefined) {
      where.push('(m.warehouse_id = ? OR m.to_warehouse_id = ?)');
      args.push(f.warehouseId, f.warehouseId);
    }
    if (f.kind) where.push(`(${KIND_SQL[f.kind]})`);
    if (f.from) {
      where.push('m.created_at >= ?');
      args.push(f.from);
    }
    if (f.to) {
      where.push('m.created_at < ?');
      args.push(f.to);
    }
    const w = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM stock_movements m JOIN products p ON p.id = m.product_id ${w}`).get(...args) as { n: number }).n);
    const raw = db
      .prepare(
        `SELECT m.id, m.product_id, p.name AS pname, p.sku, m.warehouse_id, w.name AS wname, m.to_warehouse_id, tw.name AS twname, m.moved_qty,
           m.delta, m.qty_after, m.reserved_delta, m.reserved_after, m.reason, m.ref, st.name AS sname, m.created_at
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         LEFT JOIN warehouses w ON w.id = m.warehouse_id
         LEFT JOIN warehouses tw ON tw.id = m.to_warehouse_id
         LEFT JOIN staff st ON st.id = m.staff_id
         ${w} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, f.limit, f.offset) as Record<string, unknown>[];
    return {
      total,
      rows: raw.map((r) => ({
        id: Number(r.id),
        productId: Number(r.product_id),
        productName: String(r.pname),
        sku: (r.sku as string | null) ?? null,
        warehouseId: r.warehouse_id === null ? null : Number(r.warehouse_id),
        warehouseName: (r.wname as string | null) ?? null,
        toWarehouseId: r.to_warehouse_id === null ? null : Number(r.to_warehouse_id),
        toWarehouseName: (r.twname as string | null) ?? null,
        movedQty: r.moved_qty === null ? null : Number(r.moved_qty),
        delta: Number(r.delta),
        qtyAfter: Number(r.qty_after),
        reservedDelta: Number(r.reserved_delta),
        reservedAfter: Number(r.reserved_after),
        reason: String(r.reason),
        ref: (r.ref as string | null) ?? null,
        staffName: (r.sname as string | null) ?? null,
        createdAt: String(r.created_at),
      })),
    };
  },

  /** Резервы под открытые заказы: по ссылке order:<id> и товару — сумма резерва больше нуля. */
  reserves(db: Db, f: { q?: string; limit: number; offset: number }): { rows: ReserveRow[]; total: number } {
    const args: (string | number)[] = [];
    let extra = '';
    if (f.q) {
      ensureLowerFn(db);
      extra = "AND (rts_lc(p.name) LIKE ? ESCAPE '\\' OR rts_lc(COALESCE(p.sku, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(o.number, '')) LIKE ? ESCAPE '\\')";
      const like = `%${escapeLike(f.q.toLowerCase())}%`;
      args.push(like, like, like);
    }
    const base = `FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN orders o ON ('order:' || o.id) = m.ref
      WHERE m.ref LIKE 'order:%' ${extra} GROUP BY m.ref, m.product_id HAVING SUM(m.reserved_delta) > 0`;
    const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 ${base})`).get(...args) as { n: number }).n);
    const raw = db
      .prepare(`SELECT m.ref, o.number AS onum, o.status AS ostatus, m.product_id, p.name AS pname, p.sku, SUM(m.reserved_delta) AS qty ${base} ORDER BY m.ref DESC, p.name LIMIT ? OFFSET ?`)
      .all(...args, f.limit, f.offset) as { ref: string; onum: string | null; ostatus: string | null; product_id: number; pname: string; sku: string | null; qty: number }[];
    return { total, rows: raw.map((r) => ({ ref: r.ref, orderNumber: r.onum, orderStatus: r.ostatus, productId: r.product_id, productName: r.pname, sku: r.sku, qty: Number(r.qty) })) };
  },
};
