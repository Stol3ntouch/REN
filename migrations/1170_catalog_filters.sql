-- C03: настраиваемые фильтры каталога. Панель фильтров витрины строится из этой таблицы.
CREATE TABLE catalog_filters (
  id           INTEGER PRIMARY KEY,
  kind         TEXT    NOT NULL CHECK (kind IN ('price', 'brand', 'stock', 'attribute', 'category')),
  attribute_id INTEGER REFERENCES attribute_definitions(id) ON DELETE CASCADE,
  label        TEXT    NOT NULL,
  widget       TEXT    NOT NULL CHECK (widget IN ('checkbox', 'range', 'select')),
  sort         INTEGER NOT NULL DEFAULT 0,
  enabled      INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  -- JSON: { minProducts?: 1..1000 (по умолчанию 3), maxValues?: 1..500 (по умолчанию 30) } — прежнее правило витрины
  config       TEXT    NOT NULL DEFAULT '{}',
  CHECK ((kind = 'attribute') = (attribute_id IS NOT NULL))
);
-- Один фильтр на характеристику и по одному фильтру каждого служебного вида.
CREATE UNIQUE INDEX idx_catalog_filters_attribute ON catalog_filters(attribute_id) WHERE attribute_id IS NOT NULL;
CREATE UNIQUE INDEX idx_catalog_filters_kind ON catalog_filters(kind) WHERE kind <> 'attribute';
CREATE INDEX idx_catalog_filters_enabled_sort ON catalog_filters(enabled, sort);

-- Ограничение по категориям: нет строк — фильтр показывается везде; иначе в перечисленных категориях и их потомках.
CREATE TABLE catalog_filter_categories (
  filter_id   INTEGER NOT NULL REFERENCES catalog_filters(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (filter_id, category_id)
);
CREATE INDEX idx_catalog_filter_categories_category ON catalog_filter_categories(category_id);

-- Сид воспроизводит прежнюю витрину: цена, наличие, затем характеристики (равный sort — внутри порядок по числу товаров категории,
-- как раньше). Правило «≥3 товара и ≤30 значений» живёт в config по умолчанию и применяется на витрине к каждой категории.
-- Бренд включён: пока ни у одного товара нет бренда, фильтр на витрине не появляется. Подкатегории выключены (раньше их не было).
INSERT INTO catalog_filters (kind, label, widget, sort, enabled) VALUES
  ('price', 'Цена, ₽', 'range', 10, 1),
  ('stock', 'Наличие', 'checkbox', 20, 1),
  ('brand', 'Бренд', 'checkbox', 30, 1),
  ('category', 'Подкатегория', 'checkbox', 40, 0);
INSERT INTO catalog_filters (kind, attribute_id, label, widget, sort, enabled)
  SELECT 'attribute', id, name, 'checkbox', 100, 1 FROM attribute_definitions;

-- Новая характеристика (импорт, 1С, админка) получает системный код и фильтр по умолчанию.
CREATE TRIGGER trg_attribute_definitions_defaults AFTER INSERT ON attribute_definitions
BEGIN
  UPDATE attribute_definitions SET code = 'attr_' || NEW.id WHERE id = NEW.id AND code IS NULL;
  INSERT INTO catalog_filters (kind, attribute_id, label, widget, sort, enabled) VALUES ('attribute', NEW.id, NEW.name, 'checkbox', 100, 1);
END;
