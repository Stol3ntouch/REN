import { describe, expect, it } from 'vitest';
import { stock } from '@/domain/catalog/stock';
import type { Db } from '@/server/db/connection';
import { ConflictError, ValidationError } from '@/server/http/errors';
import { addCategory, addProduct, createTestDb } from './helpers';

const T0 = Date.UTC(2026, 9, 24, 10);
const STAFF = { staffId: 7 };
const o = (db: Db, extra: Record<string, unknown> = {}) => ({ db, now: T0, ...extra });

function row(db: Db, id: number) {
  return db.prepare('SELECT stock_qty, reserved_qty, stock_tracked, availability, availability_manual, in_stock, locked_fields FROM products WHERE id = ?').get(id) as {
    stock_qty: number;
    reserved_qty: number;
    stock_tracked: number;
    availability: string;
    availability_manual: number;
    in_stock: number;
    locked_fields: string;
  };
}
const moves = (db: Db, id: number) => stock.history(id, { db });

function setup() {
  const db = createTestDb();
  const cat = addCategory(db, 'Пилы', 'pily');
  const id = addProduct(db, { name: 'Пила', categoryId: cat, inStock: true });
  return { db, id };
}

describe('stock.adjust: изменение остатка', () => {
  it('товар из импорта: остаток неизвестен (0), учёт не включён, наличие берётся из in_stock', () => {
    const { db, id } = setup();
    expect(row(db, id)).toMatchObject({ stock_qty: 0, reserved_qty: 0, stock_tracked: 0, availability: 'in_stock', in_stock: 1 });
  });

  it('delta: прибавляет, пишет операцию с причиной, автором и остатком после; включает учёт и закрепляет наличие за ручной правкой', () => {
    const { db, id } = setup();
    const res = stock.adjust(id, { delta: 5 }, 'Приход от поставщика', STAFF, o(db));
    expect(res).toMatchObject({ stockQty: 5, reservedQty: 0, availableQty: 5, availability: 'in_stock' });
    expect(row(db, id)).toMatchObject({ stock_qty: 5, stock_tracked: 1 });
    expect(JSON.parse(row(db, id).locked_fields)).toContain('in_stock');
    const m = moves(db, id);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ delta: 5, qtyAfter: 5, reason: 'Приход от поставщика', staffId: 7, reservedDelta: 0 });
    expect(m[0]!.createdAt).toBe(new Date(T0).toISOString());
  });

  it('set: задаёт значение, в истории — разница; без изменений операция не пишется', () => {
    const { db, id } = setup();
    stock.adjust(id, { set: 10 }, 'Инвентаризация', STAFF, o(db));
    stock.adjust(id, { set: 4 }, 'Инвентаризация', STAFF, o(db));
    expect(moves(db, id).map((m) => [m.delta, m.qtyAfter])).toEqual([
      [-6, 4],
      [10, 10],
    ]);
    const before = moves(db, id).length;
    stock.adjust(id, { set: 4 }, 'Повтор', STAFF, o(db));
    expect(moves(db, id)).toHaveLength(before);
  });

  it('причина обязательна, остаток не уходит ниже нуля, дробные и огромные значения отклоняются', () => {
    const { db, id } = setup();
    stock.adjust(id, { set: 3 }, 'Старт', STAFF, o(db));
    expect(() => stock.adjust(id, { delta: 1 }, '  ', STAFF, o(db))).toThrow(ValidationError);
    expect(() => stock.adjust(id, { delta: -4 }, 'Списание', STAFF, o(db))).toThrow(ConflictError);
    expect(() => stock.adjust(id, { set: -1 }, 'Минус', STAFF, o(db))).toThrow(ValidationError);
    expect(() => stock.adjust(id, { delta: 1.5 }, 'Дробь', STAFF, o(db))).toThrow(ValidationError);
    expect(() => stock.adjust(id, { set: 1e12 }, 'Много', STAFF, o(db))).toThrow(ValidationError);
    expect(row(db, id).stock_qty).toBe(3);
    expect(moves(db, id)).toHaveLength(1);
  });

  it('резерв не больше остатка; уменьшение остатка ниже резерва запрещено', () => {
    const { db, id } = setup();
    stock.adjust(id, { set: 5, reserved: 2 }, 'Старт', STAFF, o(db));
    expect(row(db, id)).toMatchObject({ stock_qty: 5, reserved_qty: 2 });
    expect(() => stock.adjust(id, { set: 5, reserved: 6 }, 'Много резерва', STAFF, o(db))).toThrow(ConflictError);
    expect(() => stock.adjust(id, { delta: -4 }, 'Ниже резерва', STAFF, o(db))).toThrow(ConflictError);
    expect(row(db, id)).toMatchObject({ stock_qty: 5, reserved_qty: 2 });
    // и сама БД не даёт нарушить правило
    expect(() => db.prepare('UPDATE products SET reserved_qty = 9 WHERE id = ?').run(id)).toThrow();
  });

  it('наличие вычисляется из свободного остатка (остаток − резерв)', () => {
    const { db, id } = setup();
    stock.adjust(id, { set: 3, reserved: 3 }, 'Всё в резерве', STAFF, o(db));
    expect(row(db, id)).toMatchObject({ availability: 'out_of_stock', in_stock: 0 });
    stock.adjust(id, { set: 3, reserved: 1 }, 'Освободили', STAFF, o(db));
    expect(row(db, id)).toMatchObject({ availability: 'in_stock', in_stock: 1 });
    stock.adjust(id, { set: 0, reserved: 0 }, 'Продано', STAFF, o(db));
    expect(row(db, id)).toMatchObject({ availability: 'out_of_stock', in_stock: 0 });
  });

  it('статус, заданный вручную, остаток не перебивает; под заказ продаётся, снят с продажи — нет', () => {
    const { db, id } = setup();
    db.prepare("UPDATE products SET availability = 'preorder', availability_manual = 1, in_stock = 1 WHERE id = ?").run(id);
    stock.adjust(id, { set: 0 }, 'Нет на складе', STAFF, o(db));
    expect(row(db, id)).toMatchObject({ availability: 'preorder', in_stock: 1 });
    db.prepare("UPDATE products SET availability = 'discontinued', in_stock = 0 WHERE id = ?").run(id);
    stock.adjust(id, { set: 9 }, 'Приход', STAFF, o(db));
    expect(row(db, id)).toMatchObject({ availability: 'discontinued', in_stock: 0 });
  });

  it('неизвестный товар → ошибка, история пуста', () => {
    const { db } = setup();
    expect(() => stock.adjust(9999, { delta: 1 }, 'x', STAFF, o(db))).toThrow(/не найден/);
  });

  it('операция атомарна: сбой на середине не оставляет частичных данных', () => {
    const { db, id } = setup();
    stock.adjust(id, { set: 5 }, 'Старт', STAFF, o(db));
    expect(() => stock.adjust(id, { set: 5, reserved: 99 }, 'Сбой', STAFF, o(db))).toThrow();
    expect(moves(db, id)).toHaveLength(1);
    expect(row(db, id).stock_qty).toBe(5);
  });
});

describe('заказы и остаток (ADR-014): резерв при оформлении, списание при передаче, возврат при отмене', () => {
  function tracked(db: Db, id: number, qty: number) {
    stock.adjust(id, { set: qty }, 'Старт', STAFF, o(db));
  }

  it('резервирует только товары с включённым учётом; для остальных остаток неизвестен — ничего не пишется', () => {
    const { db, id } = setup();
    stock.reserveForOrder(101, [{ productId: id, qty: 2 }], o(db));
    expect(row(db, id)).toMatchObject({ stock_qty: 0, reserved_qty: 0 });
    expect(moves(db, id)).toHaveLength(0);
  });

  it('резерв при оформлении: свободный остаток уменьшается, остаток на складе — нет', () => {
    const { db, id } = setup();
    tracked(db, id, 5);
    stock.reserveForOrder(101, [{ productId: id, qty: 2 }], o(db));
    expect(row(db, id)).toMatchObject({ stock_qty: 5, reserved_qty: 2, availability: 'in_stock' });
    const last = moves(db, id)[0]!;
    expect(last).toMatchObject({ delta: 0, reservedDelta: 2, reservedAfter: 2, ref: 'order:101' });
    expect(last.reason).toMatch(/резерв/i);
  });

  it('не хватает свободного остатка → ConflictError, ничего не зарезервировано (в том числе по другим позициям)', () => {
    const { db, id } = setup();
    const other = addProduct(db, { name: 'Другая', categoryId: addCategory(db, 'Д', 'd') });
    tracked(db, id, 1);
    tracked(db, other, 10);
    expect(() =>
      stock.reserveForOrder(
        102,
        [
          { productId: other, qty: 3 },
          { productId: id, qty: 2 },
        ],
        o(db),
      ),
    ).toThrow(ConflictError);
    expect(row(db, other).reserved_qty).toBe(0);
    expect(row(db, id).reserved_qty).toBe(0);
  });

  it('повторный резерв того же заказа ничего не меняет (идемпотентно)', () => {
    const { db, id } = setup();
    tracked(db, id, 5);
    stock.reserveForOrder(103, [{ productId: id, qty: 2 }], o(db));
    stock.reserveForOrder(103, [{ productId: id, qty: 2 }], o(db));
    expect(row(db, id).reserved_qty).toBe(2);
  });

  it('передан в доставку / выдан: резерв превращается в списание — один раз', () => {
    const { db, id } = setup();
    tracked(db, id, 5);
    stock.reserveForOrder(104, [{ productId: id, qty: 2 }], o(db));
    stock.onOrderStatus(104, 'processing', o(db));
    expect(row(db, id)).toMatchObject({ stock_qty: 5, reserved_qty: 2 });
    stock.onOrderStatus(104, 'shipped', o(db));
    expect(row(db, id)).toMatchObject({ stock_qty: 3, reserved_qty: 0 });
    stock.onOrderStatus(104, 'delivered', o(db));
    expect(row(db, id)).toMatchObject({ stock_qty: 3, reserved_qty: 0 });
    expect(moves(db, id)[0]).toMatchObject({ delta: -2, reservedDelta: -2, qtyAfter: 3, ref: 'order:104' });
  });

  it('самовывоз: «готов к выдаче» ещё держит резерв, списание — при выдаче', () => {
    const { db, id } = setup();
    tracked(db, id, 4);
    stock.reserveForOrder(105, [{ productId: id, qty: 1 }], o(db));
    stock.onOrderStatus(105, 'ready_for_pickup', o(db));
    expect(row(db, id)).toMatchObject({ stock_qty: 4, reserved_qty: 1 });
    stock.onOrderStatus(105, 'delivered', o(db));
    expect(row(db, id)).toMatchObject({ stock_qty: 3, reserved_qty: 0 });
  });

  it('отмена возвращает резерв; после отмены списание не происходит', () => {
    const { db, id } = setup();
    tracked(db, id, 3);
    stock.reserveForOrder(106, [{ productId: id, qty: 3 }], o(db));
    expect(row(db, id).availability).toBe('out_of_stock');
    stock.onOrderStatus(106, 'cancelled', o(db));
    expect(row(db, id)).toMatchObject({ stock_qty: 3, reserved_qty: 0, availability: 'in_stock' });
    stock.onOrderStatus(106, 'shipped', o(db));
    expect(row(db, id)).toMatchObject({ stock_qty: 3, reserved_qty: 0 });
  });

  it('возврат средств до передачи освобождает резерв; после списания остаток сам не возвращается', () => {
    const { db, id } = setup();
    tracked(db, id, 5);
    stock.reserveForOrder(107, [{ productId: id, qty: 2 }], o(db));
    stock.onOrderStatus(107, 'refunded', o(db));
    expect(row(db, id)).toMatchObject({ stock_qty: 5, reserved_qty: 0 });
    stock.reserveForOrder(108, [{ productId: id, qty: 2 }], o(db));
    stock.onOrderStatus(108, 'shipped', o(db));
    stock.onOrderStatus(108, 'refunded', o(db));
    expect(row(db, id)).toMatchObject({ stock_qty: 3, reserved_qty: 0 });
  });

  it('статусы без складских последствий (оплата, ошибка оплаты) резерв не трогают', () => {
    const { db, id } = setup();
    tracked(db, id, 5);
    stock.reserveForOrder(109, [{ productId: id, qty: 2 }], o(db));
    for (const s of ['awaiting_payment', 'payment_failed', 'paid', 'processing'] as const) stock.onOrderStatus(109, s, o(db));
    expect(row(db, id)).toMatchObject({ stock_qty: 5, reserved_qty: 2 });
  });
});
