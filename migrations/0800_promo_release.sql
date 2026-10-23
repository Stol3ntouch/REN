-- F1: промокод возвращается при отмене заказа ровно один раз. Признак хранится в заказе,
-- чтобы повторный переход или сбой посередине не уменьшили used_count второй раз.
ALTER TABLE orders ADD COLUMN promo_released INTEGER NOT NULL DEFAULT 0 CHECK (promo_released IN (0, 1));
