-- C06: категории как CMS — карточка, показ на сайте, сортировка, связи, фильтры и баннеры по категориям.
-- Глаз видимости (F6: hidden_by_admin / effective_hidden) остаётся отдельным решением; здесь — независимые настройки.

-- Изображение категории (если пусто — фото первого товара, как раньше). variants — JSON, как у брендов и баннеров.
ALTER TABLE categories ADD COLUMN image_path TEXT;
ALTER TABLE categories ADD COLUMN image_variants TEXT;
ALTER TABLE categories ADD COLUMN description TEXT;

-- «Активная»: неактивная категория недоступна на сайте вместе с поддеревом (effective_hidden учитывает и этот признак).
ALTER TABLE categories ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1));

-- Три независимые настройки показа: меню и подвал / плитки главной / дерево и листинг каталога.
ALTER TABLE categories ADD COLUMN show_in_menu INTEGER NOT NULL DEFAULT 1 CHECK (show_in_menu IN (0, 1));
ALTER TABLE categories ADD COLUMN show_on_home INTEGER NOT NULL DEFAULT 1 CHECK (show_on_home IN (0, 1));
ALTER TABLE categories ADD COLUMN show_in_catalog INTEGER NOT NULL DEFAULT 1 CHECK (show_in_catalog IN (0, 1));

-- Порядок: позиция (sort) и приоритет; чем меньше приоритет, тем выше категория.
ALTER TABLE categories ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;

-- Служебные поля: системный код (уникальный), внешний ID, комментарий администратора (на сайте не публикуется).
ALTER TABLE categories ADD COLUMN code TEXT;
ALTER TABLE categories ADD COLUMN external_ref TEXT;
ALTER TABLE categories ADD COLUMN admin_comment TEXT;

-- SEO: canonical и индексация. indexable = 0 — noindex на странице категории.
ALTER TABLE categories ADD COLUMN canonical TEXT;
ALTER TABLE categories ADD COLUMN indexable INTEGER NOT NULL DEFAULT 1 CHECK (indexable IN (0, 1));

-- Ручная правка названия и родителя закрепляет их: импорт YML не вернёт значения из фида.
ALTER TABLE categories ADD COLUMN locked_name INTEGER NOT NULL DEFAULT 0 CHECK (locked_name IN (0, 1));
ALTER TABLE categories ADD COLUMN locked_parent INTEGER NOT NULL DEFAULT 0 CHECK (locked_parent IN (0, 1));

UPDATE categories SET code = 'cat_' || id WHERE code IS NULL;
CREATE UNIQUE INDEX ux_categories_code ON categories(code) WHERE code IS NOT NULL;
CREATE INDEX idx_categories_order ON categories(priority, sort, id);

-- Новая категория (импорт, 1С, админка) получает системный код.
CREATE TRIGGER trg_categories_code AFTER INSERT ON categories WHEN NEW.code IS NULL
BEGIN
  UPDATE categories SET code = 'cat_' || NEW.id WHERE id = NEW.id;
END;

-- Связанные категории («Смотрите также»): отдельная таблица связей, пара уникальна, связь с собой запрещена.
CREATE TABLE category_related (
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  related_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  sort        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (category_id, related_id),
  CHECK (category_id <> related_id)
) WITHOUT ROWID;
CREATE INDEX idx_category_related_related ON category_related(related_id);

-- Настройка фильтров по категории (поверх общих фильтров C03): нет строки — фильтр как задан в «Фильтры каталога».
-- enabled = 0 прячет фильтр в категории и её потомках; sort переопределяет порядок. Ближайшая к категории строка в цепочке предков главнее.
CREATE TABLE category_filter_settings (
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  filter_id   INTEGER NOT NULL REFERENCES catalog_filters(id) ON DELETE CASCADE,
  sort        INTEGER,
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  PRIMARY KEY (category_id, filter_id)
) WITHOUT ROWID;
CREATE INDEX idx_category_filter_settings_filter ON category_filter_settings(filter_id);
