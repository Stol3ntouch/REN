-- T05: способы доставки и оплаты, промокоды, корзины, заказы.
-- Деньги — целые копейки. Время — unix-мс. Статусы заказа — один CHECK (таблица переходов — в src/domain/ordering/status.ts).

CREATE TABLE delivery_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('pickup', 'manual')),
  -- NULL: стоимость рассчитает менеджер (цифр не выдумываем)
  price_kopecks INTEGER CHECK (price_kopecks IS NULL OR price_kopecks >= 0),
  requires_address INTEGER NOT NULL DEFAULT 0 CHECK (requires_address IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('cash_on_delivery', 'online')),
  -- 1: тестовый метод, в production не предлагается и не принимается даже при enabled=1
  test_only INTEGER NOT NULL DEFAULT 0 CHECK (test_only IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort INTEGER NOT NULL DEFAULT 0
);

INSERT INTO delivery_methods (code, name, description, kind, price_kopecks, requires_address, enabled, sort) VALUES
  ('pickup', 'Самовывоз', 'Заберёте заказ сами. Адрес и часы работы уточнит менеджер.', 'pickup', 0, 0, 1, 10),
  ('manual', 'Доставка по согласованию', 'Стоимость и срок рассчитает менеджер после оформления заказа.', 'manual', NULL, 1, 1, 20);

INSERT INTO payment_methods (code, name, description, kind, test_only, enabled, sort) VALUES
  ('cod', 'Оплата при получении', 'Оплатите заказ при получении.', 'cash_on_delivery', 0, 1, 10);

CREATE TABLE promos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                 -- в верхнем регистре
  type TEXT NOT NULL CHECK (type IN ('percent', 'fixed')),
  value INTEGER NOT NULL CHECK (value > 0),  -- percent: 1..100; fixed: копейки
  starts_at INTEGER,
  ends_at INTEGER,
  usage_limit INTEGER CHECK (usage_limit IS NULL OR usage_limit > 0),
  used_count INTEGER NOT NULL DEFAULT 0,
  min_subtotal_kopecks INTEGER NOT NULL DEFAULT 0 CHECK (min_subtotal_kopecks >= 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (type <> 'percent' OR value <= 100)
);

CREATE TABLE carts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  guest_id TEXT,
  promo_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((user_id IS NOT NULL) <> (guest_id IS NOT NULL))
);
CREATE UNIQUE INDEX uq_carts_user ON carts (user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_carts_guest ON carts (guest_id) WHERE guest_id IS NOT NULL;

CREATE TABLE cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cart_id INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 20),
  -- что видел покупатель (цена за единицу и наличие) — для списка изменений перед заказом
  seen_unit_kopecks INTEGER NOT NULL,
  seen_in_stock INTEGER NOT NULL CHECK (seen_in_stock IN (0, 1)),
  added_at INTEGER NOT NULL,
  UNIQUE (cart_id, product_id)
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,                        -- RTS-000123, ставится сразу после вставки
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  guest_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('new', 'awaiting_payment', 'paid', 'processing', 'shipped', 'ready_for_pickup', 'delivered', 'cancelled', 'payment_failed', 'refunded')),
  contact_name TEXT NOT NULL,
  contact_name_lc TEXT NOT NULL,
  contact_email TEXT NOT NULL,               -- в нижнем регистре
  contact_phone TEXT NOT NULL,
  phone_digits TEXT NOT NULL,
  comment TEXT,
  address TEXT,
  delivery_method_id INTEGER REFERENCES delivery_methods(id),
  delivery_code TEXT NOT NULL,
  delivery_name TEXT NOT NULL,
  delivery_kind TEXT NOT NULL,
  delivery_kopecks INTEGER,                  -- NULL: рассчитает менеджер
  payment_method_id INTEGER REFERENCES payment_methods(id),
  payment_code TEXT NOT NULL,
  payment_name TEXT NOT NULL,
  payment_kind TEXT NOT NULL,
  subtotal_kopecks INTEGER NOT NULL CHECK (subtotal_kopecks >= 0),
  discount_kopecks INTEGER NOT NULL DEFAULT 0 CHECK (discount_kopecks >= 0),
  total_kopecks INTEGER NOT NULL CHECK (total_kopecks >= 0),
  promo_id INTEGER REFERENCES promos(id) ON DELETE SET NULL,
  promo_code TEXT,
  is_paid INTEGER NOT NULL DEFAULT 0 CHECK (is_paid IN (0, 1)),
  assigned_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (user_id IS NOT NULL OR guest_id IS NOT NULL)
);
CREATE INDEX idx_orders_status ON orders (status, created_at);
CREATE INDEX idx_orders_created ON orders (created_at);
CREATE INDEX idx_orders_user ON orders (user_id);
CREATE INDEX idx_orders_guest ON orders (guest_id);
CREATE INDEX idx_orders_email ON orders (contact_email);
CREATE INDEX idx_orders_phone ON orders (phone_digits);
CREATE INDEX idx_orders_assigned ON orders (assigned_staff_id);

-- Снимок строки на момент покупки: смена товара не меняет прошлый заказ.
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sku TEXT,
  price_kopecks INTEGER NOT NULL,            -- розничная цена
  discount_price_kopecks INTEGER,            -- скидочная цена, если действовала
  unit_kopecks INTEGER NOT NULL,             -- по какой цене куплено
  qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 20),
  line_kopecks INTEGER NOT NULL
);
CREATE INDEX idx_order_items_order ON order_items (order_id);
CREATE INDEX idx_order_items_product ON order_items (product_id);

CREATE TABLE order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('created', 'status', 'note', 'assigned')),
  from_status TEXT,
  to_status TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('customer', 'staff', 'system')),
  actor_id TEXT,
  note TEXT
);
CREATE INDEX idx_order_events_order ON order_events (order_id, id);
