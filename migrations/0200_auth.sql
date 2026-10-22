-- T03: покупатели, сотрудники, сессии, сброс пароля, согласия, аудит.
-- Токены (сессий и сброса) хранятся только как SHA-256 хеш; пароли — scrypt-строкой формата scrypt$N$r$p$salt$hash.

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,            -- в нижнем регистре, без пробелов по краям
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,           -- unix-мс
  last_login_at INTEGER
);

CREATE TABLE user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_user_sessions_user ON user_sessions (user_id);

CREATE TABLE password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX idx_password_resets_user ON password_resets (user_id);

CREATE TABLE staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE staff_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_staff_sessions_staff ON staff_sessions (staff_id);

-- Неудачные входы (для блокировки «5 за 15 минут на email+IP»). scope: 'user' | 'staff'.
CREATE TABLE login_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,                     -- email|ip
  at INTEGER NOT NULL                    -- unix-мс
);
CREATE INDEX idx_login_failures_key ON login_failures (scope, key, at);

-- Согласия (152-ФЗ): кто, на что, когда, откуда.
CREATE TABLE consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                    -- 'privacy' | 'marketing' | ...
  source TEXT NOT NULL,                  -- форма: 'register', 'callback', 'checkout', ...
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  guest_id TEXT,
  subject TEXT,                          -- email/телефон, на которые дано согласие (если нет user_id)
  text_version TEXT,
  granted_at INTEGER NOT NULL
);
CREATE INDEX idx_consents_user ON consents (user_id);

-- Журнал аудита: только добавление. Триггеры запрещают UPDATE и DELETE на уровне БД.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor_id TEXT,                         -- id сотрудника/пользователя; NULL для системы
  actor_type TEXT NOT NULL CHECK (actor_type IN ('staff', 'user', 'system')),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,                      -- email/телефон уже замаскированы
  after_json TEXT
);
CREATE INDEX idx_audit_entity ON audit_log (entity, entity_id);
CREATE INDEX idx_audit_at ON audit_log (at);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

-- Заглушка очереди писем до T09 (MailPort/email_outbox): domain/admin/mail-enqueue.ts.
CREATE TABLE mail_stub_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
