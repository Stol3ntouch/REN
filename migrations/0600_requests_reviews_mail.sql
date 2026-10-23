-- T09: заявки, вопросы, отзывы, исходящая почта.

-- Заявки посетителей: ремонт, заказ звонка, обратная связь, вопрос о товаре (kind).
-- Имена таблицы и столбцов (requests.kind/status, reviews.status) читает аналитика T10 (newRequests).
CREATE TABLE requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,                                     -- REM-000012, ZV-000003, MSG-…, VOP-… (ставится сразу после вставки)
  kind TEXT NOT NULL CHECK (kind IN ('repair', 'callback', 'contact', 'question')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_work', 'done', 'cancelled')),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  preferred_contact TEXT CHECK (preferred_contact IN ('phone', 'email', 'messenger')),
  equipment_type TEXT,                                    -- только ремонт
  message TEXT,                                           -- описание неисправности / текст вопроса / сообщение
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,   -- только вопрос о товаре
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  guest_id TEXT,
  consent_id INTEGER REFERENCES consents(id) ON DELETE SET NULL,
  note TEXT,                                              -- заметка менеджера
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  handled_by INTEGER                                      -- staff.id последнего, кто менял статус
);
CREATE INDEX idx_requests_kind_status ON requests (kind, status, created_at);

-- Отзывы о товарах: публично виден только status='published'.
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  guest_id TEXT,
  consent_id INTEGER REFERENCES consents(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  moderated_at INTEGER,
  moderated_by INTEGER
);
CREATE INDEX idx_reviews_product_status ON reviews (product_id, status);
CREATE INDEX idx_reviews_status ON reviews (status, created_at);

-- Исходящая почта. Адресат клиента — to_addr; для менеджеров/админа (audience) адреса берутся при отправке.
-- payload_json после успешной отправки очищается (в нём может быть ссылка со сбросом пароля).
CREATE TABLE email_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('customer', 'manager', 'admin')),
  to_addr TEXT,
  subject TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  locked_at INTEGER,
  sent_at INTEGER
);
CREATE INDEX idx_outbox_due ON email_outbox (status, next_attempt_at);
