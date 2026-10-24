-- C02: одноразовые ссылки сотрудников — сброс пароля и приглашение. В БД только SHA-256 хеш токена.
CREATE TABLE staff_password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('reset', 'invite')),
  created_by INTEGER,                    -- staff.id выдавшего ссылку; NULL — сам сотрудник (запрос «забыли пароль») или консоль
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX idx_staff_password_resets_staff ON staff_password_resets (staff_id);
