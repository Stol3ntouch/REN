-- C08: страницы-CMS. Статус (черновик / опубликована / запланирована) выводится из двух полей:
--   published = 0                                    -> черновик;
--   published = 1 и published_at > сейчас            -> запланирована (появится сама по времени);
--   published = 1 и published_at пусто или <= сейчас -> опубликована.
-- Все прежние страницы остаются опубликованными, их тексты не меняются.
ALTER TABLE pages ADD COLUMN published    INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1));
ALTER TABLE pages ADD COLUMN published_at INTEGER;
ALTER TABLE pages ADD COLUMN canonical    TEXT;
ALTER TABLE pages ADD COLUMN noindex      INTEGER NOT NULL DEFAULT 0 CHECK (noindex IN (0, 1));
ALTER TABLE pages ADD COLUMN created_at   INTEGER NOT NULL DEFAULT 0;

-- Версии страницы: снимок состояния ДО очередной правки (откат возвращает снимок).
CREATE TABLE page_versions (
  id              INTEGER PRIMARY KEY,
  page_id         INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  title           TEXT    NOT NULL,
  h1              TEXT,
  body            TEXT    NOT NULL,
  seo_title       TEXT,
  seo_description TEXT,
  canonical       TEXT,
  noindex         INTEGER NOT NULL DEFAULT 0,
  saved_by        INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_page_versions_page ON page_versions (page_id, id DESC);

-- Одноразовые ссылки предпросмотра черновика (страница или новость). В базе только хеш токена.
CREATE TABLE content_preview_tokens (
  token_hash TEXT    PRIMARY KEY,
  entity     TEXT    NOT NULL CHECK (entity IN ('pages', 'news')),
  entity_id  INTEGER NOT NULL,
  created_by INTEGER,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
