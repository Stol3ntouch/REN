-- F6: скрытие категорий каталога и страниц сайта администратором.
-- categories.hidden_by_admin — решение админа по самой категории; effective_hidden — итог с учётом родителей
-- (скрытая категория скрывает всё поддерево). effective_hidden пересчитывается при переключении и в конце импорта,
-- чтобы витрина проверяла одну колонку (visibleProductSql), а не ходила по дереву на каждый запрос.
-- Импорт YML/1С hidden_by_admin не читает и не пишет — скрытая категория после повторного импорта остаётся скрытой.
ALTER TABLE categories ADD COLUMN hidden_by_admin INTEGER NOT NULL DEFAULT 0 CHECK (hidden_by_admin IN (0, 1));
ALTER TABLE categories ADD COLUMN effective_hidden INTEGER NOT NULL DEFAULT 0 CHECK (effective_hidden IN (0, 1));
CREATE INDEX idx_categories_effective_hidden ON categories(effective_hidden) WHERE effective_hidden = 1;

-- Страницы сайта (pages): скрытая страница даёт 404 и пропадает из меню, подвала и sitemap.
-- Политику ПДн (на неё ссылаются формы) скрыть нельзя — запрещает сервер (domain/content/ops.ts).
ALTER TABLE pages ADD COLUMN hidden_by_admin INTEGER NOT NULL DEFAULT 0 CHECK (hidden_by_admin IN (0, 1));
