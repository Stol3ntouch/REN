-- C08: баннеры (позиции: home_hero — главная, category — страница категории, top_strip — полоса над шапкой, home_middle).
-- Активность по датам: starts_at / ends_at (пусто — без границы). status: active | inactive.
CREATE TABLE banners (
  id                     INTEGER PRIMARY KEY,
  title                  TEXT    NOT NULL,
  image_path             TEXT,
  image_variants         TEXT,
  mobile_image_path      TEXT,
  mobile_image_variants  TEXT,
  alt                    TEXT,
  heading                TEXT,
  subheading             TEXT,
  button_text            TEXT,
  url                    TEXT,
  position               TEXT    NOT NULL DEFAULT 'home_hero',
  starts_at              INTEGER,
  ends_at                INTEGER,
  sort                   INTEGER NOT NULL DEFAULT 0,
  status                 TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at             INTEGER NOT NULL DEFAULT 0,
  updated_at             INTEGER NOT NULL
);
CREATE INDEX idx_banners_position ON banners (position, status, sort);

-- Привязка баннера категории к категориям каталога.
CREATE TABLE banner_categories (
  banner_id   INTEGER NOT NULL REFERENCES banners(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  sort        INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  PRIMARY KEY (banner_id, category_id)
);
CREATE INDEX idx_banner_categories_category ON banner_categories (category_id, enabled, sort);

-- Слайды главной переезжают в баннеры позиции home_hero без потерь (заголовок, подпись, ссылка, кнопка, фото, alt, порядок, показ).
-- Таблица slides остаётся как была (история); сайт читает только banners.
INSERT INTO banners (title, image_path, image_variants, alt, heading, subheading, button_text, url, position, sort, status, created_at, updated_at)
SELECT title, image_path, image_variants, image_alt, title, subtitle, link_label, link_url, 'home_hero', sort,
       CASE active WHEN 1 THEN 'active' ELSE 'inactive' END, updated_at, updated_at
FROM slides;
