-- C12: налоговые ставки. Ставка в сотых долях процента (2000 = 20 %). Ставок по умолчанию нет: налог не выдумываем.
CREATE TABLE tax_rates (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  rate_bp           INTEGER NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  included_in_price INTEGER NOT NULL DEFAULT 1 CHECK (included_in_price IN (0, 1)),
  is_default        INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort              INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_tax_rates_default ON tax_rates (is_default) WHERE is_default = 1;
