-- C12: доставка и оплата. Деньги — целые копейки; доли процента — «сотые доли процента» (150 = 1,5 %).
-- Существующие способы получают безопасные значения по умолчанию: поведение оформления заказа не меняется.

-- Доставка: порог бесплатной доставки, география, сроки (текст пишет администратор), минимальная сумма заказа.
ALTER TABLE delivery_methods ADD COLUMN free_from_kopecks INTEGER CHECK (free_from_kopecks IS NULL OR free_from_kopecks >= 0);
-- JSON-массив строк (регионы и города); NULL — вся страна.
ALTER TABLE delivery_methods ADD COLUMN regions_json TEXT;
ALTER TABLE delivery_methods ADD COLUMN eta_text TEXT;
ALTER TABLE delivery_methods ADD COLUMN min_order_kopecks INTEGER NOT NULL DEFAULT 0 CHECK (min_order_kopecks >= 0);

-- Оплата: комиссия, пределы суммы, режим провайдера. Секретов в БД нет и не будет (ADR-016): ключи живут в окружении.
ALTER TABLE payment_methods ADD COLUMN fee_percent_bp INTEGER NOT NULL DEFAULT 0 CHECK (fee_percent_bp BETWEEN 0 AND 10000);
ALTER TABLE payment_methods ADD COLUMN fee_fixed_kopecks INTEGER NOT NULL DEFAULT 0 CHECK (fee_fixed_kopecks >= 0);
ALTER TABLE payment_methods ADD COLUMN min_kopecks INTEGER CHECK (min_kopecks IS NULL OR min_kopecks >= 0);
ALTER TABLE payment_methods ADD COLUMN max_kopecks INTEGER CHECK (max_kopecks IS NULL OR max_kopecks >= 0);
ALTER TABLE payment_methods ADD COLUMN mode TEXT NOT NULL DEFAULT 'live' CHECK (mode IN ('test', 'live'));
UPDATE payment_methods SET mode = 'test' WHERE test_only = 1;

-- Заказ: комиссия, налог и снимок правил на момент оформления (нужен, чтобы правка состава пересчитывала по тем же правилам).
ALTER TABLE orders ADD COLUMN payment_fee_kopecks INTEGER NOT NULL DEFAULT 0 CHECK (payment_fee_kopecks >= 0);
ALTER TABLE orders ADD COLUMN tax_kopecks INTEGER NOT NULL DEFAULT 0 CHECK (tax_kopecks >= 0);
ALTER TABLE orders ADD COLUMN tax_mode TEXT CHECK (tax_mode IS NULL OR tax_mode IN ('included', 'added'));
ALTER TABLE orders ADD COLUMN charges_json TEXT;
ALTER TABLE order_items ADD COLUMN tax_rate_bp INTEGER;
ALTER TABLE order_items ADD COLUMN tax_kopecks INTEGER;
