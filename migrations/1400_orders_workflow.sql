-- C09: рабочий процесс заказов. (1) статус «Подтверждён» (confirmed) в CHECK orders.status;
-- (2) расширенные виды событий order_events (возврат на шаг, правка данных/состава, ручная оплата, комментарий);
-- (3) внутренние комментарии order_comments; (4) журнал складских эффектов заказа (идемпотентность).
--
-- Сопоставление старых статусов (без изменения данных — коды остаются, меняются только названия в интерфейсе, см. docs/adr/0008):
--   processing → «Собирается», shipped → «Передан в доставку», delivered → «Выполнен»; новый статус confirmed → «Подтверждён».
--   awaiting_payment / paid / payment_failed / refunded / ready_for_pickup — технические, сохраняются как были.
--
-- Пересоздание orders: SQLite не умеет менять CHECK. DROP TABLE orders при включённых внешних ключах каскадно стёр бы
-- order_items и order_events и обнулил onec_exports.order_id, поэтому дочерние строки сохраняются во временные таблицы
-- и возвращаются; платежи и журнал webhook (NO ACTION) переживают пересоздание за счёт отложенной проверки ключей.

PRAGMA defer_foreign_keys = ON;

CREATE TEMP TABLE c09_orders AS SELECT * FROM orders;
CREATE TEMP TABLE c09_items AS SELECT * FROM order_items;
CREATE TEMP TABLE c09_events AS SELECT * FROM order_events;
CREATE TEMP TABLE c09_onec AS SELECT order_number, order_id FROM onec_exports WHERE order_id IS NOT NULL;

CREATE TABLE orders_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  guest_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('new', 'confirmed', 'awaiting_payment', 'paid', 'processing', 'shipped', 'ready_for_pickup', 'delivered', 'cancelled', 'payment_failed', 'refunded')),
  contact_name TEXT NOT NULL,
  contact_name_lc TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  phone_digits TEXT NOT NULL,
  comment TEXT,
  address TEXT,
  delivery_method_id INTEGER REFERENCES delivery_methods(id),
  delivery_code TEXT NOT NULL,
  delivery_name TEXT NOT NULL,
  delivery_kind TEXT NOT NULL,
  delivery_kopecks INTEGER,
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
  promo_released INTEGER NOT NULL DEFAULT 0 CHECK (promo_released IN (0, 1)),
  CHECK (user_id IS NOT NULL OR guest_id IS NOT NULL)
);

DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

-- Вставка уже в таблицу «orders»: только так отложенная проверка ключей засчитывает вернувшихся родителей (платежи, webhook).
INSERT INTO orders (id, number, user_id, guest_id, status, contact_name, contact_name_lc, contact_email, contact_phone, phone_digits,
    comment, address, delivery_method_id, delivery_code, delivery_name, delivery_kind, delivery_kopecks,
    payment_method_id, payment_code, payment_name, payment_kind, subtotal_kopecks, discount_kopecks, total_kopecks,
    promo_id, promo_code, is_paid, assigned_staff_id, idempotency_key, created_at, updated_at, promo_released)
  SELECT id, number, user_id, guest_id, status, contact_name, contact_name_lc, contact_email, contact_phone, phone_digits,
    comment, address, delivery_method_id, delivery_code, delivery_name, delivery_kind, delivery_kopecks,
    payment_method_id, payment_code, payment_name, payment_kind, subtotal_kopecks, discount_kopecks, total_kopecks,
    promo_id, promo_code, is_paid, assigned_staff_id, idempotency_key, created_at, updated_at, promo_released
  FROM c09_orders;


CREATE INDEX idx_orders_status ON orders (status, created_at);
CREATE INDEX idx_orders_created ON orders (created_at);
CREATE INDEX idx_orders_user ON orders (user_id);
CREATE INDEX idx_orders_guest ON orders (guest_id);
CREATE INDEX idx_orders_email ON orders (contact_email);
CREATE INDEX idx_orders_phone ON orders (phone_digits);
CREATE INDEX idx_orders_assigned ON orders (assigned_staff_id);
CREATE INDEX idx_orders_total ON orders (total_kopecks);

-- Дочерние строки возвращаются на место (id сохраняются).
INSERT INTO order_items (id, order_id, product_id, name, sku, price_kopecks, discount_price_kopecks, unit_kopecks, qty, line_kopecks)
  SELECT id, order_id, product_id, name, sku, price_kopecks, discount_price_kopecks, unit_kopecks, qty, line_kopecks FROM c09_items;
UPDATE onec_exports SET order_id = (SELECT order_id FROM c09_onec b WHERE b.order_number = onec_exports.order_number)
  WHERE order_id IS NULL AND order_number IN (SELECT order_number FROM c09_onec);

-- События: те же, плюс новые виды. order_events пуст (каскад), таблица пересоздаётся с широким CHECK.
DROP TABLE order_events;
CREATE TABLE order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('created', 'status', 'note', 'assigned', 'revert', 'edit', 'items', 'payment.manual')),
  from_status TEXT,
  to_status TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('customer', 'staff', 'system')),
  actor_id TEXT,
  note TEXT
);
CREATE INDEX idx_order_events_order ON order_events (order_id, id);
INSERT INTO order_events (id, order_id, at, kind, from_status, to_status, actor_type, actor_id, note)
  SELECT id, order_id, at, kind, from_status, to_status, actor_type, actor_id, note FROM c09_events;

DROP TABLE c09_orders;
DROP TABLE c09_items;
DROP TABLE c09_events;
DROP TABLE c09_onec;

-- Внутренние комментарии сотрудников: отдельные записи с автором и временем, покупателю не показываются.
CREATE TABLE order_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_order_comments_order ON order_comments (order_id, id);

-- Складские эффекты заказа, уже применённые через порт остатков (ordering/stock-port.ts): повтор не вызывает порт второй раз.
CREATE TABLE order_stock_effects (
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  effect TEXT NOT NULL CHECK (effect IN ('reserve', 'commit', 'release')),
  at INTEGER NOT NULL,
  PRIMARY KEY (order_id, effect)
) WITHOUT ROWID;
