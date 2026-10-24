-- C08: категории новостей, автор, canonical и noindex. Статус выводится из published / published_at (как у страниц).
CREATE TABLE news_categories (
  id         INTEGER PRIMARY KEY,
  slug       TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
ALTER TABLE news ADD COLUMN category_id     INTEGER REFERENCES news_categories(id) ON DELETE SET NULL;
ALTER TABLE news ADD COLUMN author_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL;
ALTER TABLE news ADD COLUMN author_name     TEXT;
ALTER TABLE news ADD COLUMN canonical       TEXT;
ALTER TABLE news ADD COLUMN noindex         INTEGER NOT NULL DEFAULT 0 CHECK (noindex IN (0, 1));
CREATE INDEX idx_news_category ON news (category_id);
