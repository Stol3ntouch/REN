-- F3: скрытие позиций товаров администратором.
-- Отдельный признак от published (который задаёт ручная правка) и не связан с locked_fields:
-- импорт YML/1С эту колонку не читает и не пишет, поэтому повторный импорт скрытый товар в продажу не возвращает.
-- Витрина показывает товар, только если published = 1 AND hidden_by_admin = 0 (одно условие — visibleProductSql).
ALTER TABLE products ADD COLUMN hidden_by_admin INTEGER NOT NULL DEFAULT 0 CHECK (hidden_by_admin IN (0, 1));
CREATE INDEX idx_products_hidden ON products(hidden_by_admin) WHERE hidden_by_admin = 1;
