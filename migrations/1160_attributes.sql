-- C03: универсальные характеристики. Прежние (строковые) данные не меняются: тип по умолчанию string,
-- значение product_attributes.value остаётся как было; числовое представление value_num заполняется только для типов number/boolean.
ALTER TABLE attribute_definitions ADD COLUMN code TEXT;
ALTER TABLE attribute_definitions ADD COLUMN type TEXT NOT NULL DEFAULT 'string' CHECK (type IN ('string', 'number', 'boolean', 'list', 'date'));
ALTER TABLE attribute_definitions ADD COLUMN unit TEXT;
ALTER TABLE attribute_definitions ADD COLUMN required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1));
ALTER TABLE attribute_definitions ADD COLUMN filterable INTEGER NOT NULL DEFAULT 1 CHECK (filterable IN (0, 1));
ALTER TABLE attribute_definitions ADD COLUMN comparable INTEGER NOT NULL DEFAULT 1 CHECK (comparable IN (0, 1));
ALTER TABLE attribute_definitions ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;

-- Системный код: для существующих — attr_<id> (администратор может переименовать на понятный).
UPDATE attribute_definitions SET code = 'attr_' || id WHERE code IS NULL;
CREATE UNIQUE INDEX idx_attribute_definitions_code ON attribute_definitions(code);

-- Допустимые значения характеристики типа list.
CREATE TABLE attribute_allowed_values (
  id           INTEGER PRIMARY KEY,
  attribute_id INTEGER NOT NULL REFERENCES attribute_definitions(id) ON DELETE CASCADE,
  value        TEXT    NOT NULL,
  sort         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (attribute_id, value)
);

-- Ограничение по категориям: нет строк — характеристика применима ко всем; иначе к перечисленным категориям и их потомкам.
CREATE TABLE attribute_categories (
  attribute_id INTEGER NOT NULL REFERENCES attribute_definitions(id) ON DELETE CASCADE,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (attribute_id, category_id)
);
CREATE INDEX idx_attribute_categories_category ON attribute_categories(category_id);

-- Числовое значение (number: само число; boolean: 0/1). NULL — значение нечисловое.
ALTER TABLE product_attributes ADD COLUMN value_num REAL;
CREATE INDEX idx_product_attributes_attr_num ON product_attributes(attribute_id, value_num) WHERE value_num IS NOT NULL;
-- Покрывающий индекс для EXISTS-проверок фильтров: товар → характеристика → значение.
CREATE INDEX idx_product_attributes_product_attr ON product_attributes(product_id, attribute_id, value);
