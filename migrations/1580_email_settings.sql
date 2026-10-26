-- C12: события писем × получатели и свои шаблоны. Нет строки — действует значение по умолчанию (включено, текст из кода).
CREATE TABLE email_event_settings (
  event      TEXT    NOT NULL,
  audience   TEXT    NOT NULL CHECK (audience IN ('customer', 'manager', 'admin')),
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (event, audience)
);

CREATE TABLE email_templates (
  event      TEXT    NOT NULL,
  audience   TEXT    NOT NULL CHECK (audience IN ('customer', 'manager', 'admin')),
  subject    TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER,
  PRIMARY KEY (event, audience)
);

CREATE INDEX idx_email_outbox_event ON email_outbox (event, id);
CREATE INDEX idx_email_outbox_created ON email_outbox (created_at);
