/*
 * Остатки товара (C04, ADR-014). Единственное место, где меняются stock_qty и reserved_qty.
 *
 * Модель проста и намеренно без складов (склады — C12):
 *  - остаток (stock_qty) — сколько физически есть; резерв (reserved_qty) — сколько обещано открытым заказам;
 *    свободно = остаток − резерв;
 *  - учёт (stock_tracked) включается, когда остаток впервые задан вручную: у товаров из YML/1С количество неизвестно,
 *    их наличие даёт флаг in_stock из файла, и заказ их не резервирует (остатки не выдумываем);
 *  - резерв — при оформлении заказа, списание — когда заказ передан в доставку или выдан (shipped / delivered),
 *    возврат резерва — при отмене или возврате денег до передачи;
 *  - каждая операция пишется в stock_movements с причиной, автором и ссылкой (order:<id>).
 */
import { withTransaction, getDb, type Db } from '@/server/db/connection';
import { warehousesRepo } from '@/server/db/repositories/warehouses';
import { stockRepo, isSellable, type Availability, type StockMovementRow, type StockRow } from '@/server/db/repositories/stock';
import { ConflictError, NotFoundError, ValidationError } from '@/server/http/errors';

export type { Availability, StockMovementRow };

export const MAX_STOCK = 1_000_000_000;
export const MAX_REASON_LENGTH = 300;

type Opts = { db?: Db; now?: number; ref?: string | null; /** C12: операция на конкретном складе (иначе — склад по умолчанию). */ warehouseId?: number | null };

/** Изменить остаток на delta или задать значение; reserved — новое значение резерва (необязательно). */
export type StockChange = ({ delta: number } | { set: number }) & { reserved?: number };

export type StockState = {
  productId: number;
  stockQty: number;
  reservedQty: number;
  availableQty: number;
  availability: Availability;
  /** false — операции не было (значения не изменились). */
  changed: boolean;
};

const iso = (now: number) => new Date(now).toISOString();

function int(v: unknown, label: string, min: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new ValidationError(`${label}: нужно целое число`, { [label]: [`${label}: нужно целое число`] });
  if (v < min || v > MAX_STOCK) throw new ValidationError(`${label}: от ${min} до ${MAX_STOCK}`);
  return v;
}

/** Наличие по остатку для товара без ручного статуса. */
function derive(row: StockRow, stockQty: number, reservedQty: number): Availability {
  if (row.availabilityManual) return row.availability;
  return stockQty - reservedQty > 0 ? 'in_stock' : 'out_of_stock';
}

function lock(row: StockRow): string[] {
  return row.lockedFields.includes('in_stock') ? row.lockedFields : [...row.lockedFields, 'in_stock'];
}

function state(productId: number, stockQty: number, reservedQty: number, availability: Availability, changed: boolean): StockState {
  return { productId, stockQty, reservedQty, availableQty: stockQty - reservedQty, availability, changed };
}

export const stock = {
  /**
   * Ручная операция с остатком (приход, инвентаризация, списание). Причина обязательна, остаток не уходит ниже нуля,
   * резерв не превышает остаток. Всё в одной транзакции вместе с записью в историю.
   */
  adjust(productId: number, change: StockChange, reason: string, staff: { staffId: number } | null, opts: Opts = {}): StockState {
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const why = (reason ?? '').trim();
    if (why === '') throw new ValidationError('Укажите причину изменения остатка', { stockReason: ['Укажите причину изменения остатка'] });
    if (why.length > MAX_REASON_LENGTH) throw new ValidationError(`Причина не длиннее ${MAX_REASON_LENGTH} символов`, { stockReason: ['Причина слишком длинная'] });
    if ('set' in change) int(change.set, 'Остаток', 0);
    else int(change.delta, 'Изменение остатка', -MAX_STOCK);
    if (change.reserved !== undefined) int(change.reserved, 'Резерв', 0);

    return withTransaction(db, () => {
      const row = stockRepo.get(db, productId);
      if (!row) throw new NotFoundError('Товар не найден');
      const nextStock = 'set' in change ? change.set : row.stockQty + change.delta;
      if (nextStock < 0) throw new ConflictError('Остаток не может быть отрицательным');
      if (nextStock > MAX_STOCK) throw new ValidationError(`Остаток не больше ${MAX_STOCK}`);
      const nextReserved = change.reserved ?? row.reservedQty;
      if (nextReserved > nextStock) throw new ConflictError('Резерв не может быть больше остатка');

      const delta = nextStock - row.stockQty;
      const reservedDelta = nextReserved - row.reservedQty;
      if (delta === 0 && reservedDelta === 0) return state(productId, row.stockQty, row.reservedQty, row.availability, false);

      const availability = derive(row, nextStock, nextReserved);
      stockRepo.save(db, productId, { stockQty: nextStock, reservedQty: nextReserved, availability, lockedFields: lock(row), now: iso(now), warehouseId: opts.warehouseId ?? null });
      stockRepo.insertMovement(db, {
        productId,
        delta,
        qtyAfter: nextStock,
        reservedDelta,
        reservedAfter: nextReserved,
        reason: why,
        ref: opts.ref ?? null,
        staffId: staff?.staffId ?? null,
        createdAt: iso(now),
        warehouseId: opts.warehouseId ?? warehousesRepo.defaultId(db),
      });
      return state(productId, nextStock, nextReserved, availability, true);
    });
  },

  /** История операций по товару, новые сверху. */
  history(productId: number, opts: { db?: Db } = {}, limit = 100): StockMovementRow[] {
    return stockRepo.listMovements(opts.db ?? getDb(), productId, limit);
  },

  /** Состояние остатка товара (null — нет такого товара). */
  state(productId: number, opts: { db?: Db } = {}): StockState | null {
    const row = stockRepo.get(opts.db ?? getDb(), productId);
    return row ? state(productId, row.stockQty, row.reservedQty, row.availability, false) : null;
  },

  /**
   * Резерв при оформлении заказа. Только для товаров с включённым учётом; не хватает свободного остатка — ConflictError
   * и ничего не резервируется (транзакция вызывающего откатывается). Повторный вызов для того же заказа ничего не меняет.
   */
  reserveForOrder(orderId: number, items: readonly { productId: number; qty: number }[], opts: Opts = {}): void {
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const ref = `order:${orderId}`;
    const wanted = new Map<number, number>();
    for (const i of items) wanted.set(i.productId, (wanted.get(i.productId) ?? 0) + i.qty);

    withTransaction(db, () => {
      for (const [productId, qty] of wanted) {
        const row = stockRepo.get(db, productId);
        if (!row || !row.tracked) continue;
        if (stockRepo.hasRefMovement(db, ref, productId)) continue;
        const free = row.stockQty - row.reservedQty;
        if (qty > free) {
          throw new ConflictError(`Товара «${row.name}» недостаточно на складе: доступно ${Math.max(free, 0)} шт.`);
        }
        const reserved = row.reservedQty + qty;
        stockRepo.save(db, productId, { stockQty: row.stockQty, reservedQty: reserved, availability: derive(row, row.stockQty, reserved), lockedFields: lock(row), now: iso(now) });
        stockRepo.insertMovement(db, {
          productId,
          delta: 0,
          qtyAfter: row.stockQty,
          reservedDelta: qty,
          reservedAfter: reserved,
          reason: 'Резерв под заказ',
          ref,
          staffId: null,
          createdAt: iso(now),
        });
      }
    });
  },

  /**
   * Складские последствия смены статуса заказа. shipped / delivered — списание резерва (один раз),
   * cancelled / refunded — возврат ещё не списанного резерва. Остальные статусы остаток не трогают.
   */
  onOrderStatus(orderId: number, to: string, opts: Opts = {}): void {
    const writeOff = to === 'shipped' || to === 'delivered';
    const release = to === 'cancelled' || to === 'refunded';
    if (!writeOff && !release) return;
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const ref = `order:${orderId}`;

    withTransaction(db, () => {
      for (const { productId, net } of stockRepo.netReservedByRef(db, ref)) {
        if (net <= 0) continue;
        const row = stockRepo.get(db, productId);
        if (!row) continue;
        const qty = Math.min(net, row.reservedQty);
        if (qty <= 0) continue;
        const nextStock = writeOff ? row.stockQty - qty : row.stockQty;
        const nextReserved = row.reservedQty - qty;
        stockRepo.save(db, productId, { stockQty: nextStock, reservedQty: nextReserved, availability: derive(row, nextStock, nextReserved), lockedFields: lock(row), now: iso(now) });
        stockRepo.insertMovement(db, {
          productId,
          delta: writeOff ? -qty : 0,
          qtyAfter: nextStock,
          reservedDelta: -qty,
          reservedAfter: nextReserved,
          reason: writeOff ? 'Списание по заказу' : 'Возврат резерва: заказ отменён',
          ref,
          staffId: null,
          createdAt: iso(now),
        });
      }
    });
  },
};

export { isSellable };
