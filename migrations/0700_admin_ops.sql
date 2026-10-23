-- T10: журнал запусков интеграций, экспорт заказов в 1С, флаги админки, SEO товара. Время — unix-мс.

-- Каждый запуск обмена (1С, оплата, импорт-по-расписанию): что, чем кончилось, сколько записей, какие ошибки.
CREATE TABLE integration_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                              -- onec.pull_catalog | onec.push_order | onec.pull_statuses | payment.create_payment | payment.webhook | payment.refund
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'error')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  counts TEXT NOT NULL DEFAULT '{}',               -- JSON: { ключ: число }
  errors TEXT NOT NULL DEFAULT '[]',               -- JSON: строки без секретов
  actor TEXT NOT NULL DEFAULT 'system'             -- 'staff:<id>' | 'system' | 'cli'
);
CREATE INDEX idx_integration_run_started ON integration_run (started_at);
CREATE INDEX idx_integration_run_kind ON integration_run (kind, id);

-- Какие заказы уже ушли в «outbox 1С» (идемпотентность по номеру заказа на сайте).
CREATE TABLE onec_exports (
  order_number TEXT PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  exported_at INTEGER NOT NULL
);

-- Флаги и настройки админки (НЕ shop_settings T08). Ключи: catalog.manualEdit ('0'|'1'), notifications.recipients (JSON-массив email).
CREATE TABLE admin_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

-- SEO-поля товара, правимые вручную (в таблице products их нет).
CREATE TABLE product_seo (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  seo_title TEXT,
  seo_description TEXT,
  updated_at INTEGER NOT NULL
);
