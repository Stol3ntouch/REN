-- Лимитер запросов: фиксированное окно на ключ (см. src/server/http/rate-limit.ts).
-- Хранится в БД, чтобы счётчики переживали перезапуск и были общими для процессов.
CREATE TABLE rate_limit (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL, -- unix-секунды начала окна
  count INTEGER NOT NULL
);

CREATE INDEX idx_rate_limit_window_start ON rate_limit (window_start);
