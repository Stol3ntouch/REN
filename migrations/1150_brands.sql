-- C03: бренды. Привязка товара — products.brand_id (необязательная, NULL — бренд не указан).
-- source/external_id нужны импорту и обмену с 1С: бренд из данных находится по (source, external_id), а не выдумывается.
CREATE TABLE brands (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL,
  slug            TEXT    NOT NULL UNIQUE,
  logo_path       TEXT,
  logo_variants   TEXT,
  description     TEXT,
  site_url        TEXT,
  published       INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
  archived        INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  sort            INTEGER NOT NULL DEFAULT 0,
  seo_title       TEXT,
  seo_description TEXT,
  source          TEXT    NOT NULL DEFAULT 'manual',
  external_id     TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX idx_brands_source_external ON brands(source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_brands_list ON brands(archived, published, sort);

-- Внешний ключ без каскада удаления: удалять бренд с товарами запрещает код (ConflictError), БД лишь обнуляет ссылку.
ALTER TABLE products ADD COLUMN brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL;
CREATE INDEX idx_products_brand ON products(brand_id);
