import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { hasPermission, requirePermission, type Permission, type StaffSession } from '@/domain/admin/permissions';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { settingsRepo } from '@/server/db/repositories/settings';
import { stockRepo } from '@/server/db/repositories/stock';
import {
  warehousesRepo,
  type MovementFilter,
  type MovementListRow,
  type ReserveRow,
  type StockTableFilter,
  type StockTableRow,
  type WarehouseRow,
} from '@/server/db/repositories/warehouses';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { MAX_REASON_LENGTH, MAX_STOCK, stock } from './stock';

/**
 * Склады и операции между ними (C12, ADR-016).
 * Инвариант: для товара с учётом products.stock_qty = Σ stock_by_warehouse.qty и products.reserved_qty = Σ stock_by_warehouse.reserved.
 * Его держит единственная точка записи остатка (stockRepo.save → warehousesRepo.reconcile); перемещение между складами
 * сумму по товару не меняет. Каждая операция пишется в stock_movements с причиной, автором и складом.
 */

type Opts = { db?: Db; now?: number };

export const LOW_STOCK_KEY = 'low_stock_threshold';
export const DEFAULT_LOW_STOCK = 5;
export const MAX_LOW_STOCK = 1_000_000;

const READ_PERMS: readonly Permission[] = ['warehouses.write', 'products.read', 'catalog.read'];

function requireRead(session: StaffSession | null | undefined): asserts session is StaffSession {
  if (!session) throw new UnauthorizedError('Требуется вход в админку');
  if (!READ_PERMS.some((p) => hasPermission(session, p))) throw new ForbiddenError('Недостаточно прав для этого действия');
}

const warehouseSchema = z.object({
  name: z.string().trim().min(2, 'Название: не короче 2 знаков').max(100, 'Название: не длиннее 100 знаков'),
  address: z
    .string()
    .trim()
    .max(300, 'Адрес: не длиннее 300 знаков')
    .nullish()
    .transform((v) => (v ? v : null)),
  active: z.boolean(),
  sort: z.number().int().min(0).max(9999),
});

function fail(issues: { message: string; path: PropertyKey[] }[]): never {
  const fields: Record<string, string[]> = {};
  for (const i of issues) (fields[String(i.path[0] ?? 'form')] ??= []).push(i.message);
  throw new ValidationError(issues[0]?.message ?? 'Проверьте поля формы', fields);
}

export type WarehouseView = WarehouseRow & { qty: number; reserved: number; products: number };

export const warehousesAdmin = {
  list(session: StaffSession | null, opts: Opts = {}): WarehouseView[] {
    requireRead(session);
    const db = opts.db ?? getDb();
    return warehousesRepo.list(db).map((w) => ({ ...w, ...warehousesRepo.totals(db, w.id) }));
  },

  create(session: StaffSession | null, input: unknown, opts: Opts = {}): number {
    requirePermission(session, 'warehouses.write');
    const p = warehouseSchema.safeParse(input);
    if (!p.success) fail(p.error.issues);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      const id = warehousesRepo.insert(db, p.data, now);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'warehouse.create', entity: 'warehouse', entityId: id, after: { name: p.data.name, active: p.data.active } }, { db, now });
      return id;
    });
  },

  update(session: StaffSession | null, id: number, input: unknown, opts: Opts = {}): void {
    requirePermission(session, 'warehouses.write');
    const p = warehouseSchema.safeParse(input);
    if (!p.success) fail(p.error.issues);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const before = warehousesRepo.find(db, id);
      if (!before) throw new NotFoundError('Склад не найден');
      if (!p.data.active) {
        if (before.isDefault) throw new ConflictError('Склад по умолчанию нельзя отключить: сначала назначьте другой');
        const t = warehousesRepo.totals(db, id);
        if (t.qty > 0 || t.reserved > 0) throw new ConflictError('На складе есть остатки: переместите их на другой склад, затем отключите');
      }
      warehousesRepo.update(db, id, p.data);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'warehouse.update', entity: 'warehouse', entityId: id, before: { name: before.name, active: before.active }, after: { name: p.data.name, active: p.data.active } },
        { db, now },
      );
    });
  },

  setDefault(session: StaffSession | null, id: number, opts: Opts = {}): void {
    requirePermission(session, 'warehouses.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const w = warehousesRepo.find(db, id);
      if (!w) throw new NotFoundError('Склад не найден');
      if (!w.active) throw new ConflictError('Складом по умолчанию может быть только действующий склад');
      if (w.isDefault) return;
      const before = warehousesRepo.defaultId(db);
      warehousesRepo.setDefault(db, id);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'warehouse.default', entity: 'warehouse', entityId: id, before: { id: before }, after: { id } }, { db, now });
    });
  },

  /** Удалить можно склад без остатков и без истории (ошибочно заведённый); иначе — отключить. */
  remove(session: StaffSession | null, id: number, opts: Opts = {}): void {
    requirePermission(session, 'warehouses.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const w = warehousesRepo.find(db, id);
      if (!w) throw new NotFoundError('Склад не найден');
      if (w.isDefault) throw new ConflictError('Склад по умолчанию удалить нельзя');
      const t = warehousesRepo.totals(db, id);
      if (t.qty > 0 || t.reserved > 0) throw new ConflictError('На складе есть остатки: удалить нельзя');
      if (warehousesRepo.hasHistory(db, id)) throw new ConflictError('По складу есть история операций: удалить нельзя, отключите его');
      warehousesRepo.delete(db, id);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'warehouse.delete', entity: 'warehouse', entityId: id, before: { name: w.name } }, { db, now });
    });
  },
};

// ---------------------------------------------------------------- операции с остатком по складам

const qtySchema = z.number({ error: 'Укажите количество' }).int('Количество — целое число').min(1, 'Количество: не меньше 1').max(MAX_STOCK, 'Слишком большое количество');
const reasonSchema = z
  .string({ error: 'Укажите причину' })
  .trim()
  .min(1, 'Укажите причину')
  .max(MAX_REASON_LENGTH, `Причина не длиннее ${MAX_REASON_LENGTH} символов`);

const opSchema = z.object({ productId: z.number().int().positive(), warehouseId: z.number().int().positive(), qty: qtySchema, reason: reasonSchema });
const transferSchema = z.object({
  productId: z.number().int().positive(),
  fromWarehouseId: z.number().int().positive(),
  toWarehouseId: z.number().int().positive(),
  qty: qtySchema,
  reason: reasonSchema,
});

const iso = (now: number) => new Date(now).toISOString();

export type StockOpResult = { productId: number; warehouseId: number; warehouseQty: number; totalQty: number };

export const warehouseStock = {
  /** Оприходование: остаток склада растёт. Учёт у товара включается (ADR-014). */
  receive(session: StaffSession | null, input: unknown, opts: Opts = {}): StockOpResult {
    requirePermission(session, 'warehouses.write');
    const p = opSchema.safeParse(input);
    if (!p.success) fail(p.error.issues);
    const v = p.data;
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      const w = warehousesRepo.find(db, v.warehouseId);
      if (!w) throw new NotFoundError('Склад не найден');
      if (!w.active) throw new ConflictError('Склад отключён: оприходовать на него нельзя');
      if (!stockRepo.get(db, v.productId)) throw new NotFoundError('Товар не найден');
      const res = stock.adjust(v.productId, { delta: v.qty }, v.reason, { staffId: session.staffId }, { db, now, warehouseId: v.warehouseId });
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'warehouse.receive', entity: 'product', entityId: v.productId, after: { warehouseId: v.warehouseId, qty: v.qty, reason: v.reason } },
        { db, now },
      );
      return { productId: v.productId, warehouseId: v.warehouseId, warehouseQty: warehousesRepo.row(db, v.productId, v.warehouseId)?.qty ?? 0, totalQty: res.stockQty };
    });
  },

  /** Списание (брак, потеря, инвентаризация): только из свободного остатка склада. */
  writeOff(session: StaffSession | null, input: unknown, opts: Opts = {}): StockOpResult {
    requirePermission(session, 'warehouses.write');
    const p = opSchema.safeParse(input);
    if (!p.success) fail(p.error.issues);
    const v = p.data;
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      if (!warehousesRepo.find(db, v.warehouseId)) throw new NotFoundError('Склад не найден');
      if (!stockRepo.get(db, v.productId)) throw new NotFoundError('Товар не найден');
      const row = warehousesRepo.row(db, v.productId, v.warehouseId);
      const free = row ? row.qty - row.reserved : 0;
      if (v.qty > free) throw new ConflictError(`На складе свободно только ${free} шт.: списать ${v.qty} нельзя`);
      const res = stock.adjust(v.productId, { delta: -v.qty }, v.reason, { staffId: session.staffId }, { db, now, warehouseId: v.warehouseId });
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'warehouse.writeoff', entity: 'product', entityId: v.productId, after: { warehouseId: v.warehouseId, qty: v.qty, reason: v.reason } },
        { db, now },
      );
      return { productId: v.productId, warehouseId: v.warehouseId, warehouseQty: warehousesRepo.row(db, v.productId, v.warehouseId)?.qty ?? 0, totalQty: res.stockQty };
    });
  },

  /** Перемещение между складами: итог по товару не меняется; двигается только свободный остаток источника. */
  transfer(session: StaffSession | null, input: unknown, opts: Opts = {}): void {
    requirePermission(session, 'warehouses.write');
    const p = transferSchema.safeParse(input);
    if (!p.success) fail(p.error.issues);
    const v = p.data;
    if (v.fromWarehouseId === v.toWarehouseId) throw new ValidationError('Склады отправления и назначения совпадают', { toWarehouseId: ['Выберите другой склад'] });
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const from = warehousesRepo.find(db, v.fromWarehouseId);
      const to = warehousesRepo.find(db, v.toWarehouseId);
      if (!from || !to) throw new NotFoundError('Склад не найден');
      if (!to.active) throw new ConflictError('Склад назначения отключён');
      const product = stockRepo.get(db, v.productId);
      if (!product) throw new NotFoundError('Товар не найден');
      const src = warehousesRepo.row(db, v.productId, v.fromWarehouseId);
      const free = src ? src.qty - src.reserved : 0;
      if (v.qty > free) throw new ConflictError(`На складе «${from.name}» свободно только ${free} шт.: переместить ${v.qty} нельзя`);
      const dst = warehousesRepo.row(db, v.productId, v.toWarehouseId);
      warehousesRepo.putRow(db, v.productId, v.fromWarehouseId, (src as { qty: number }).qty - v.qty, (src as { reserved: number }).reserved);
      warehousesRepo.putRow(db, v.productId, v.toWarehouseId, (dst?.qty ?? 0) + v.qty, dst?.reserved ?? 0);
      stockRepo.insertMovement(db, {
        productId: v.productId,
        delta: 0,
        qtyAfter: product.stockQty,
        reservedDelta: 0,
        reservedAfter: product.reservedQty,
        reason: v.reason,
        ref: null,
        staffId: session.staffId,
        createdAt: iso(now),
        warehouseId: v.fromWarehouseId,
        toWarehouseId: v.toWarehouseId,
        movedQty: v.qty,
      });
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'warehouse.transfer', entity: 'product', entityId: v.productId, after: { from: v.fromWarehouseId, to: v.toWarehouseId, qty: v.qty, reason: v.reason } },
        { db, now },
      );
    });
  },

  /** Остатки одного товара по складам (для карточки и формы операций). */
  byWarehouse(session: StaffSession | null, productId: number, opts: Opts = {}): { warehouseId: number; name: string; qty: number; reserved: number }[] {
    requireRead(session);
    const db = opts.db ?? getDb();
    const names = new Map(warehousesRepo.list(db).map((w) => [w.id, w.name]));
    return warehousesRepo.rowsFor(db, productId).map((r) => ({ warehouseId: r.warehouseId, name: names.get(r.warehouseId) ?? '—', qty: r.qty, reserved: r.reserved }));
  },
};

// ---------------------------------------------------------------- порог и списки

export function readLowStockThreshold(db: Db): number {
  const raw = settingsRepo.get(db, LOW_STOCK_KEY);
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= MAX_LOW_STOCK ? n : DEFAULT_LOW_STOCK;
}

export const warehouseReports = {
  threshold(session: StaffSession | null, opts: Opts = {}): number {
    requireRead(session);
    return readLowStockThreshold(opts.db ?? getDb());
  },

  setThreshold(session: StaffSession | null, value: unknown, opts: Opts = {}): void {
    requirePermission(session, 'warehouses.write');
    const p = z
      .number({ error: 'Порог — целое число' })
      .int('Порог — целое число')
      .min(0, 'Порог не может быть отрицательным')
      .max(MAX_LOW_STOCK, 'Слишком большой порог')
      .safeParse(value);
    if (!p.success) fail(p.error.issues);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const before = readLowStockThreshold(db);
      settingsRepo.set(db, LOW_STOCK_KEY, String(p.data), now);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'warehouse.threshold', entity: 'settings', entityId: LOW_STOCK_KEY, before: { value: before }, after: { value: p.data } }, { db, now });
    });
  },

  stock(session: StaffSession | null, f: Omit<StockTableFilter, 'lowThreshold'> & { lowOnly?: boolean }, opts: Opts = {}): { rows: StockTableRow[]; total: number; threshold: number } {
    requireRead(session);
    const db = opts.db ?? getDb();
    const threshold = readLowStockThreshold(db);
    const { lowOnly, ...rest } = f;
    return { ...warehousesRepo.stockTable(db, { ...rest, ...(lowOnly ? { lowThreshold: threshold } : {}) }), threshold };
  },

  movements(session: StaffSession | null, f: MovementFilter, opts: Opts = {}): { rows: MovementListRow[]; total: number } {
    requireRead(session);
    return warehousesRepo.movements(opts.db ?? getDb(), f);
  },

  reserves(session: StaffSession | null, f: { q?: string; limit: number; offset: number }, opts: Opts = {}): { rows: ReserveRow[]; total: number } {
    requireRead(session);
    return warehousesRepo.reserves(opts.db ?? getDb(), f);
  },

  /** Расхождения «сумма по складам ≠ остаток товара»; должно быть пусто. */
  violations(session: StaffSession | null, opts: Opts = {}) {
    requireRead(session);
    return warehousesRepo.invariantViolations(opts.db ?? getDb());
  },
};
