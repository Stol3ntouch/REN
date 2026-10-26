-- C12: резервные копии из интерфейса и проверки соединения интеграций.

CREATE TABLE backups (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  kind              TEXT    NOT NULL CHECK (kind IN ('manual', 'pre_restore')),
  status            TEXT    NOT NULL CHECK (status IN ('queued', 'running', 'ok', 'error')),
  progress          INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  file_name         TEXT,
  size_bytes        INTEGER,
  sha256            TEXT,
  files_count       INTEGER,
  migration_version INTEGER,
  error             TEXT,
  created_by        INTEGER,
  created_at        INTEGER NOT NULL,
  started_at        INTEGER,
  finished_at       INTEGER,
  verified_at       INTEGER,
  verify_ok         INTEGER CHECK (verify_ok IS NULL OR verify_ok IN (0, 1)),
  verify_message    TEXT
);
CREATE INDEX idx_backups_created ON backups (created_at);

-- Одноразовые ссылки на скачивание: в БД только хеш токена.
CREATE TABLE backup_download_tokens (
  token_hash TEXT PRIMARY KEY,
  backup_id  INTEGER NOT NULL REFERENCES backups(id) ON DELETE CASCADE,
  staff_id   INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);

-- Результат последней проверки соединения. «Подключено» показывается только при status = ok и совпавшем отпечатке настроек.
CREATE TABLE integration_checks (
  key         TEXT PRIMARY KEY,
  status      TEXT    NOT NULL CHECK (status IN ('ok', 'error')),
  checked_at  INTEGER NOT NULL,
  message     TEXT,
  fingerprint TEXT    NOT NULL,
  checked_by  INTEGER
);
