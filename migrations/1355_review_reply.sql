-- C08: ответ администратора под отзывом о товаре.
ALTER TABLE reviews ADD COLUMN admin_reply TEXT;
ALTER TABLE reviews ADD COLUMN replied_at  INTEGER;
ALTER TABLE reviews ADD COLUMN replied_by  INTEGER;
