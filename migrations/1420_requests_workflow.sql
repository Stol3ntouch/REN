-- C09: обращения и заявки на ремонт. Один поток requests, два набора статусов:
--   обращения (contact | question | callback): new | in_work | waiting | closed;
--   ремонт (repair): new | diagnostics | awaiting_approval | in_repair | awaiting_parts | ready | completed | cancelled.
-- Допустимость переходов — в домене (src/domain/requests/workflow.ts), в БД — общий CHECK со всеми значениями.
--
-- Сопоставление старых статусов (данные не теряются):
--   обращения: done → closed, cancelled → closed (отмена обращения — тоже закрытие), in_work и new без изменений;
--   ремонт:    in_work → diagnostics, done → completed, cancelled → cancelled, new без изменений.
-- Таблицу на неё никто не ссылается, поэтому пересоздание безопасно.

CREATE TABLE requests_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('repair', 'callback', 'contact', 'question')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_work', 'waiting', 'closed', 'diagnostics', 'awaiting_approval', 'in_repair', 'awaiting_parts', 'ready', 'completed', 'cancelled')),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  preferred_contact TEXT CHECK (preferred_contact IN ('phone', 'email', 'messenger')),
  equipment_type TEXT,
  message TEXT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  guest_id TEXT,
  consent_id INTEGER REFERENCES consents(id) ON DELETE SET NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  handled_by INTEGER,
  subject TEXT,                                                       -- тема обращения (необязательна)
  assigned_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,  -- ответственный
  repair_brand TEXT,                                                  -- только ремонт: бренд
  repair_model TEXT                                                   -- только ремонт: модель
);

INSERT INTO requests_new (id, number, kind, status, name, phone, email, preferred_contact, equipment_type, message, product_id, user_id, guest_id, consent_id, note, created_at, updated_at, handled_by)
  SELECT id, number, kind,
    CASE
      WHEN kind = 'repair' AND status = 'in_work' THEN 'diagnostics'
      WHEN kind = 'repair' AND status = 'done' THEN 'completed'
      WHEN kind <> 'repair' AND status IN ('done', 'cancelled') THEN 'closed'
      ELSE status
    END,
    name, phone, email, preferred_contact, equipment_type, message, product_id, user_id, guest_id, consent_id, note, created_at, updated_at, handled_by
  FROM requests;

DROP TABLE requests;
ALTER TABLE requests_new RENAME TO requests;

CREATE INDEX idx_requests_kind_status ON requests (kind, status, created_at);
CREATE INDEX idx_requests_assigned ON requests (assigned_staff_id);

-- Фото к заявке на ремонт (до 5): файлы в data/uploads, путь относительный.
CREATE TABLE request_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_request_photos_request ON request_photos (request_id, position);

-- Комментарии сотрудников (внутренние, клиенту не видны).
CREATE TABLE request_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_request_comments_request ON request_comments (request_id, id);

-- История обработки: статус, назначение, правка, комментарий, фото. Строки только добавляются.
CREATE TABLE request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('created', 'status', 'assigned', 'comment', 'edit', 'photo')),
  from_status TEXT,
  to_status TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('customer', 'staff', 'system')),
  actor_id TEXT,
  note TEXT
);
CREATE INDEX idx_request_events_request ON request_events (request_id, id);
