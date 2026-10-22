-- T06: платежи и журнал webhook. Деньги — копейки, время — unix-мс. Данные карты не хранятся и не запрашиваются.

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL,                       -- 'test' | код настоящего провайдера
  -- refund_pending: возврат зарезервирован, вызов провайдера идёт (защита от двойного клика)
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'refund_pending', 'refunded', 'error')),
  amount_kopecks INTEGER NOT NULL CHECK (amount_kopecks > 0),
  currency TEXT NOT NULL DEFAULT 'RUB' CHECK (currency = 'RUB'),
  external_id TEXT NOT NULL UNIQUE,             -- id платежа у провайдера (для error — служебный err_…)
  redirect_url TEXT,
  return_url TEXT,
  refunded_kopecks INTEGER NOT NULL DEFAULT 0 CHECK (refunded_kopecks >= 0),
  error_code TEXT,                              -- timeout | unavailable | rejected
  error_message TEXT,                           -- без секретов
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_payments_order ON payments (order_id, id);
CREATE INDEX idx_payments_status ON payments (status, created_at);
-- У заказа не более одного ожидающего платежа: повторное нажатие не создаёт дубль.
CREATE UNIQUE INDEX uq_payments_pending_order ON payments (order_id) WHERE status = 'pending';

CREATE TABLE webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payment_external_id TEXT,
  order_id INTEGER REFERENCES orders(id),
  -- received: принято, не завершено (повтор будет обработан); processed/ignored: итог;
  -- alert: нужна реакция оператора (оплата по отменённому заказу и т.п.); error: сбой обработки
  outcome TEXT NOT NULL CHECK (outcome IN ('received', 'processed', 'ignored', 'alert', 'error')),
  detail TEXT,
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  UNIQUE (provider, event_id)
);
CREATE INDEX idx_webhook_events_outcome ON webhook_events (outcome, received_at);
