-- T02: каталог (категории, товары, изображения, характеристики) и журнал импорта.
-- Деньги — целые копейки. Идемпотентность обмена — UNIQUE (source, external_id).

CREATE TABLE categories (
  id              INTEGER PRIMARY KEY,
  source          TEXT    NOT NULL DEFAULT 'yml',
  external_id     TEXT    NOT NULL,
  parent_id       INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name            TEXT    NOT NULL,
  slug            TEXT    NOT NULL UNIQUE,
  seo_title       TEXT,
  seo_description TEXT,
  h1              TEXT,
  seo_text        TEXT,
  sort            INTEGER NOT NULL DEFAULT 0,
  UNIQUE (source, external_id)
);
CREATE INDEX idx_categories_parent ON categories(parent_id);

CREATE TABLE products (
  id                     INTEGER PRIMARY KEY,
  source                 TEXT    NOT NULL DEFAULT 'yml',
  external_id            TEXT    NOT NULL,
  sku                    TEXT,
  name                   TEXT    NOT NULL,
  slug                   TEXT    NOT NULL UNIQUE,
  description            TEXT,
  category_id            INTEGER NOT NULL REFERENCES categories(id),
  price_kopecks          INTEGER NOT NULL CHECK (price_kopecks >= 0),
  discount_price_kopecks INTEGER CHECK (discount_price_kopecks IS NULL OR discount_price_kopecks >= 0),
  in_stock               INTEGER NOT NULL DEFAULT 1 CHECK (in_stock IN (0, 1)),
  published              INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  featured               INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  first_seen_at          TEXT    NOT NULL,
  updated_at             TEXT    NOT NULL,
  -- JSON-массив имён полей, которые импорт не перезаписывает (name, sku, description, category, price, in_stock, attributes, images)
  locked_fields          TEXT    NOT NULL DEFAULT '[]',
  UNIQUE (source, external_id)
);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_sku ON products(sku);

CREATE TABLE product_images (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url_source  TEXT    NOT NULL,
  -- путь относительно data/uploads; NULL, пока фото не скачано
  path        TEXT,
  -- JSON: [{ key, width, height, path }]
  variants    TEXT,
  alt         TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, url_source)
);
CREATE INDEX idx_product_images_product ON product_images(product_id, sort);

CREATE TABLE attribute_definitions (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE product_attributes (
  id           INTEGER PRIMARY KEY,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attribute_id INTEGER NOT NULL REFERENCES attribute_definitions(id),
  value        TEXT    NOT NULL,
  sort         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_product_attributes_product ON product_attributes(product_id, sort);
CREATE INDEX idx_product_attributes_attr ON product_attributes(attribute_id, value);

CREATE TABLE import_runs (
  id                 INTEGER PRIMARY KEY,
  file_name          TEXT,
  mode               TEXT    NOT NULL CHECK (mode IN ('preview', 'apply')),
  actor_id           INTEGER,
  started_at         TEXT    NOT NULL,
  finished_at        TEXT,
  categories_created INTEGER NOT NULL DEFAULT 0,
  categories_updated INTEGER NOT NULL DEFAULT 0,
  products_created   INTEGER NOT NULL DEFAULT 0,
  products_updated   INTEGER NOT NULL DEFAULT 0,
  products_unchanged INTEGER NOT NULL DEFAULT 0,
  images_stored      INTEGER NOT NULL DEFAULT 0,
  images_failed      INTEGER NOT NULL DEFAULT 0,
  error_count        INTEGER NOT NULL DEFAULT 0,
  -- JSON-массив ошибок по строкам (обрезан до первых 500)
  errors             TEXT    NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_import_runs_started ON import_runs(started_at);
