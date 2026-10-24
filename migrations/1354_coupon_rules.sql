-- C08: купон не суммируется с акционной ценой (по выбору администратора): такие позиции не входят в базу скидки купона.
-- «Один купон на заказ»: в корзине и заказе хранится один код (carts.promo_code, orders.promo_code).
ALTER TABLE promos ADD COLUMN exclude_on_sale INTEGER NOT NULL DEFAULT 0 CHECK (exclude_on_sale IN (0, 1));
