-- C08: категории услуг.
CREATE TABLE service_categories (
  id         INTEGER PRIMARY KEY,
  slug       TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
ALTER TABLE services ADD COLUMN category_id INTEGER REFERENCES service_categories(id) ON DELETE SET NULL;
CREATE INDEX idx_services_category ON services (category_id);
