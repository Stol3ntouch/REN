-- C08: акции с правилами. discount_type none — акция только информирует (цены не меняет).
-- Участвуют товары (promotion_products) и/или категории вместе с подкатегориями (promotion_categories).
-- Цена за единицу считается на сервере (domain/pricing/promotion-rules.ts); на товар действует не более одной акции (макс. приоритет).
ALTER TABLE promotions ADD COLUMN conditions           TEXT;
ALTER TABLE promotions ADD COLUMN discount_type        TEXT    NOT NULL DEFAULT 'none' CHECK (discount_type IN ('percent', 'fixed', 'none'));
-- percent: 1..99; fixed: копейки
ALTER TABLE promotions ADD COLUMN discount_value       INTEGER NOT NULL DEFAULT 0 CHECK (discount_value >= 0);
-- акция действует, если сумма товаров корзины по обычным ценам не меньше этой суммы
ALTER TABLE promotions ADD COLUMN min_subtotal_kopecks INTEGER NOT NULL DEFAULT 0 CHECK (min_subtotal_kopecks >= 0);
-- верхняя граница скидки на единицу товара (пусто — без границы)
ALTER TABLE promotions ADD COLUMN max_discount_kopecks INTEGER CHECK (max_discount_kopecks IS NULL OR max_discount_kopecks > 0);
ALTER TABLE promotions ADD COLUMN priority             INTEGER NOT NULL DEFAULT 0;
ALTER TABLE promotions ADD COLUMN created_at           INTEGER NOT NULL DEFAULT 0;

CREATE TABLE promotion_products (
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, product_id)
);
CREATE INDEX idx_promotion_products_product ON promotion_products (product_id);

CREATE TABLE promotion_categories (
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, category_id)
);
