-- C12: склады и остатки по складам (ADR-016). По умолчанию один склад; сумма по складам равна products.stock_qty (инвариант держит сервис).

CREATE TABLE warehouses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  address    TEXT,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
-- Склад по умолчанию ровно один; он всегда активен (проверяет сервис).
CREATE UNIQUE INDEX ux_warehouses_default ON warehouses (is_default) WHERE is_default = 1;

CREATE TABLE stock_by_warehouse (
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  qty          INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  reserved     INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  PRIMARY KEY (product_id, warehouse_id),
  CHECK (reserved <= qty)
);
CREATE INDEX idx_stock_by_warehouse_wh ON stock_by_warehouse (warehouse_id, product_id);

-- Адрес склада не придумываем: его вводит владелец.
INSERT INTO warehouses (name, address, active, is_default, sort, created_at)
VALUES ('Основной склад', NULL, 1, 1, 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

-- Учёт числом есть только у товаров с включённым учётом (ADR-014): весь их остаток — на складе по умолчанию.
INSERT INTO stock_by_warehouse (product_id, warehouse_id, qty, reserved)
SELECT p.id, (SELECT id FROM warehouses WHERE is_default = 1), p.stock_qty, p.reserved_qty FROM products p WHERE p.stock_tracked = 1;

-- Движение: склад операции; перемещение — одна строка с нулевыми delta (сумма по товару не меняется), складом-источником и складом-получателем.
ALTER TABLE stock_movements ADD COLUMN warehouse_id INTEGER REFERENCES warehouses(id);
ALTER TABLE stock_movements ADD COLUMN to_warehouse_id INTEGER REFERENCES warehouses(id);
ALTER TABLE stock_movements ADD COLUMN moved_qty INTEGER CHECK (moved_qty IS NULL OR moved_qty > 0);
CREATE INDEX idx_stock_movements_wh ON stock_movements (warehouse_id, id);
CREATE INDEX idx_stock_movements_created ON stock_movements (created_at);
-- Прежняя история ручных операций относилась к единственному складу.
UPDATE stock_movements SET warehouse_id = (SELECT id FROM warehouses WHERE is_default = 1) WHERE reserved_delta = 0 AND delta <> 0;
