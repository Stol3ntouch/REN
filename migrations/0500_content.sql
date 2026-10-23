-- T08: контент — настройки магазина, страницы, слайды, новости, услуги, акции, отзывы о компании.
-- Время — unix-мс. Выдуманного содержимого нет: только телефон из брифа и страницы-заглушки с метками.

CREATE TABLE shop_settings (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Единственный факт от владельца, уже известный: телефон магазина (бриф, дополнение 2026-10-22).
INSERT INTO shop_settings (key, value, updated_at) VALUES ('phone', '+7 916-655-06-06', 0);

-- Страницы с редактируемыми текстом и SEO. key — устойчивый системный ключ (about, delivery, …),
-- slug — адрес, его можно менять. legal_draft=1 — на странице видна метка «ЧЕРНОВИК — проверить юристом».
CREATE TABLE pages (
  id              INTEGER PRIMARY KEY,
  key             TEXT    UNIQUE,
  slug            TEXT    NOT NULL UNIQUE,
  title           TEXT    NOT NULL,
  h1              TEXT,
  seo_title       TEXT,
  seo_description TEXT,
  body            TEXT    NOT NULL DEFAULT '',
  legal_draft     INTEGER NOT NULL DEFAULT 0 CHECK (legal_draft IN (0, 1)),
  sort            INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL
);

INSERT INTO pages (key, slug, title, body, legal_draft, sort, updated_at) VALUES
  ('about', 'about', 'О компании', '[ТЕКСТ О КОМПАНИИ — впиши]', 0, 10, 0),
  ('delivery', 'delivery-payment', 'Доставка и оплата',
   'Доступные способы получения и оплаты показываются при оформлении заказа: самовывоз, доставка по согласованию с менеджером (стоимость рассчитывает менеджер), оплата при получении.' || char(10) || char(10) || '[УСЛОВИЯ ДОСТАВКИ И ОПЛАТЫ — впиши]', 1, 20, 0),
  ('warranty', 'warranty-returns', 'Гарантия и возврат', '[УСЛОВИЯ ГАРАНТИИ И ВОЗВРАТА — впиши]', 1, 30, 0),
  ('faq', 'faq', 'Вопросы и ответы', '[ВОПРОСЫ И ОТВЕТЫ — впиши]', 1, 40, 0),
  ('terms', 'terms', 'Условия продажи',
   '[ПОЛНОЕ НАИМЕНОВАНИЕ ПРОДАВЦА — впиши]' || char(10) || char(10) || '[УСЛОВИЯ ПРОДАЖИ — впиши]', 1, 50, 0),
  ('privacy', 'privacy', 'Политика обработки персональных данных',
   '## 1. Оператор' || char(10) || '[НАИМЕНОВАНИЕ И РЕКВИЗИТЫ ОПЕРАТОРА — впиши]' || char(10) || char(10) ||
   '## 2. Какие данные мы собираем' || char(10) ||
   'Только те, что вы сами вводите в формах сайта: имя, электронная почта, телефон, адрес доставки, текст обращения или заявки, данные заказа.' || char(10) || char(10) ||
   '## 3. Зачем' || char(10) ||
   'Для оформления и выполнения заказов, ответа на обращения и заявки на ремонт, входа в личный кабинет.' || char(10) || char(10) ||
   '## 4. Сроки хранения, права субъекта данных, порядок отзыва согласия' || char(10) ||
   '[ТЕКСТ ПОЛИТИКИ — впиши]', 1, 60, 0);

-- Слайдер главной: не больше трёх (проверяет и сервер, и триггер).
CREATE TABLE slides (
  id             INTEGER PRIMARY KEY,
  title          TEXT    NOT NULL,
  subtitle       TEXT,
  link_url       TEXT,
  link_label     TEXT,
  image_path     TEXT,
  image_variants TEXT,
  image_alt      TEXT,
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort           INTEGER NOT NULL DEFAULT 0,
  updated_at     INTEGER NOT NULL
);
CREATE TRIGGER slides_max_three BEFORE INSERT ON slides
WHEN (SELECT COUNT(*) FROM slides) >= 3
BEGIN
  SELECT RAISE(ABORT, 'slides_limit');
END;

CREATE TABLE news (
  id              INTEGER PRIMARY KEY,
  slug            TEXT    NOT NULL UNIQUE,
  title           TEXT    NOT NULL,
  h1              TEXT,
  seo_title       TEXT,
  seo_description TEXT,
  excerpt         TEXT,
  body            TEXT    NOT NULL DEFAULT '',
  image_path      TEXT,
  image_variants  TEXT,
  image_alt       TEXT,
  published       INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  published_at    INTEGER,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE promotions (
  id              INTEGER PRIMARY KEY,
  slug            TEXT    NOT NULL UNIQUE,
  title           TEXT    NOT NULL,
  h1              TEXT,
  seo_title       TEXT,
  seo_description TEXT,
  summary         TEXT,
  body            TEXT    NOT NULL DEFAULT '',
  image_path      TEXT,
  image_variants  TEXT,
  image_alt       TEXT,
  -- промокод только для показа; применяется в корзине (серверная проверка — T05)
  promo_code      TEXT,
  starts_at       INTEGER,
  ends_at         INTEGER,
  published       INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  sort            INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE services (
  id              INTEGER PRIMARY KEY,
  slug            TEXT    NOT NULL UNIQUE,
  title           TEXT    NOT NULL,
  h1              TEXT,
  seo_title       TEXT,
  seo_description TEXT,
  summary         TEXT,
  body            TEXT    NOT NULL DEFAULT '',
  -- цена текстом («от …»), только если её ввёл админ; иначе не показывается
  price_text      TEXT,
  image_path      TEXT,
  image_variants  TEXT,
  image_alt       TEXT,
  published       INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  sort            INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL
);

-- Отзывы о компании вносит и публикует админ; рейтинг необязателен и не усредняется.
CREATE TABLE company_reviews (
  id          INTEGER PRIMARY KEY,
  author_name TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  rating      INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  reviewed_at INTEGER,
  published   INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  sort        INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);
