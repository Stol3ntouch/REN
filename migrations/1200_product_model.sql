-- C04: расширенная модель товара. Деньги — целые копейки.
-- Данные импорта сохраняются: in_stock остаётся (зеркало availability), все новые поля имеют безопасные значения по умолчанию.

ALTER TABLE products ADD COLUMN barcode TEXT;
ALTER TABLE products ADD COLUMN short_description TEXT;
-- Старая («зачёркнутая») цена: показывается только если больше цены к оплате. Чисто витринное поле, в расчёт заказа не входит.
ALTER TABLE products ADD COLUMN old_price_kopecks INTEGER CHECK (old_price_kopecks IS NULL OR old_price_kopecks >= 0);
-- Закупочная цена. Читается только при праве products.cost; витрина и общие выборки её не трогают.
ALTER TABLE products ADD COLUMN purchase_price_kopecks INTEGER CHECK (purchase_price_kopecks IS NULL OR purchase_price_kopecks >= 0);
ALTER TABLE products ADD COLUMN stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0);
ALTER TABLE products ADD COLUMN reserved_qty INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0);
-- Учёт остатка включается, когда остаток впервые задан вручную или заказом: до этого количество неизвестно (данные импорта), наличие даёт in_stock.
ALTER TABLE products ADD COLUMN stock_tracked INTEGER NOT NULL DEFAULT 0 CHECK (stock_tracked IN (0, 1));
ALTER TABLE products ADD COLUMN availability TEXT NOT NULL DEFAULT 'in_stock' CHECK (availability IN ('in_stock', 'out_of_stock', 'preorder', 'discontinued'));
-- 1 — статус наличия задан администратором и не вычисляется из остатка.
ALTER TABLE products ADD COLUMN availability_manual INTEGER NOT NULL DEFAULT 0 CHECK (availability_manual IN (0, 1));
ALTER TABLE products ADD COLUMN is_new INTEGER NOT NULL DEFAULT 0 CHECK (is_new IN (0, 1));
ALTER TABLE products ADD COLUMN is_promo INTEGER NOT NULL DEFAULT 0 CHECK (is_promo IN (0, 1));
ALTER TABLE products ADD COLUMN canonical_url TEXT;
ALTER TABLE products ADD COLUMN indexable INTEGER NOT NULL DEFAULT 1 CHECK (indexable IN (0, 1));
ALTER TABLE products ADD COLUMN created_at TEXT;
ALTER TABLE products ADD COLUMN created_by INTEGER;

UPDATE products SET availability = CASE WHEN in_stock = 1 THEN 'in_stock' ELSE 'out_of_stock' END;
UPDATE products SET created_at = first_seen_at WHERE created_at IS NULL;

CREATE INDEX idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_products_visibility ON products(published, hidden_by_admin);

-- Резерв не больше остатка (дополнительно к проверке в сервисе stock).
CREATE TRIGGER trg_products_stock_guard_i BEFORE INSERT ON products
WHEN NEW.reserved_qty > NEW.stock_qty
BEGIN SELECT RAISE(ABORT, 'reserved_qty exceeds stock_qty'); END;
CREATE TRIGGER trg_products_stock_guard_u BEFORE UPDATE OF stock_qty, reserved_qty ON products
WHEN NEW.reserved_qty > NEW.stock_qty
BEGIN SELECT RAISE(ABORT, 'reserved_qty exceeds stock_qty'); END;

-- Категории товара: одна основная (дублируется в products.category_id) и несколько дополнительных.
CREATE TABLE product_categories (
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  is_primary  INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  sort        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, category_id)
);
CREATE INDEX idx_product_categories_category ON product_categories(category_id, product_id);
CREATE UNIQUE INDEX ux_product_categories_primary ON product_categories(product_id) WHERE is_primary = 1;

INSERT INTO product_categories (product_id, category_id, is_primary, sort) SELECT id, category_id, 1, 0 FROM products;

-- Основная категория всегда есть в product_categories: поддерживают триггеры, чтобы импорт и любой другой код не расходились с таблицей.
CREATE TRIGGER trg_products_primary_category_i AFTER INSERT ON products
BEGIN
  INSERT INTO product_categories (product_id, category_id, is_primary, sort) VALUES (NEW.id, NEW.category_id, 1, 0);
END;
CREATE TRIGGER trg_products_primary_category_u AFTER UPDATE OF category_id ON products
WHEN NEW.category_id <> OLD.category_id
BEGIN
  DELETE FROM product_categories WHERE product_id = NEW.id AND (is_primary = 1 OR category_id = NEW.category_id);
  INSERT INTO product_categories (product_id, category_id, is_primary, sort) VALUES (NEW.id, NEW.category_id, 1, 0);
END;

-- История операций с остатком. delta — изменение остатка, reserved_delta — изменение резерва; *_after — значения после операции.
CREATE TABLE stock_movements (
  id             INTEGER PRIMARY KEY,
  product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta          INTEGER NOT NULL,
  qty_after      INTEGER NOT NULL CHECK (qty_after >= 0),
  reserved_delta INTEGER NOT NULL DEFAULT 0,
  reserved_after INTEGER NOT NULL DEFAULT 0 CHECK (reserved_after >= 0),
  reason         TEXT    NOT NULL,
  ref            TEXT,
  staff_id       INTEGER,
  created_at     TEXT    NOT NULL
);
CREATE INDEX idx_stock_movements_product ON stock_movements(product_id, id);
CREATE INDEX idx_stock_movements_ref ON stock_movements(ref) WHERE ref IS NOT NULL;
