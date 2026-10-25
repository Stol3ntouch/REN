-- C09: клиенты в админке. Статус клиента (фиксированный список) и заметки менеджеров.
-- blocked — вход и оформление заказа запрещены (проверяют customers/auth и ordering/checkout).

ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'vip', 'blocked'));

-- Заметки менеджера о клиенте: отдельные записи с автором и временем, клиенту не показываются.
CREATE TABLE customer_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_customer_notes_user ON customer_notes (user_id, id);
