-- T04: полнотекстовый поиск товаров по названию и артикулу (FTS5).
-- sku_norm — артикул без пробелов и разделителей («HT-625R» → «HT625R»), чтобы «ht 625r» находил HT625R.
-- Индекс ведут триггеры; rowid совпадает с products.id.

CREATE VIRTUAL TABLE product_search USING fts5(
  name,
  sku,
  sku_norm,
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO product_search (rowid, name, sku, sku_norm)
SELECT id, name, COALESCE(sku, ''),
       replace(replace(replace(replace(replace(replace(replace(replace(COALESCE(sku, ''), ' ', ''), '-', ''), '.', ''), '/', ''), '_', ''), ',', ''), '(', ''), ')', '')
FROM products;

CREATE TRIGGER product_search_ai AFTER INSERT ON products BEGIN
  INSERT INTO product_search (rowid, name, sku, sku_norm)
  VALUES (new.id, new.name, COALESCE(new.sku, ''),
          replace(replace(replace(replace(replace(replace(replace(replace(COALESCE(new.sku, ''), ' ', ''), '-', ''), '.', ''), '/', ''), '_', ''), ',', ''), '(', ''), ')', ''));
END;

CREATE TRIGGER product_search_au AFTER UPDATE OF name, sku ON products BEGIN
  DELETE FROM product_search WHERE rowid = old.id;
  INSERT INTO product_search (rowid, name, sku, sku_norm)
  VALUES (new.id, new.name, COALESCE(new.sku, ''),
          replace(replace(replace(replace(replace(replace(replace(replace(COALESCE(new.sku, ''), ' ', ''), '-', ''), '.', ''), '/', ''), '_', ''), ',', ''), '(', ''), ')', ''));
END;

CREATE TRIGGER product_search_ad AFTER DELETE ON products BEGIN
  DELETE FROM product_search WHERE rowid = old.id;
END;
