-- C11: подтверждение email при регистрации (переключатель «Требовать подтверждение email»).
-- Все существующие покупатели считаются подтверждёнными: включение переключателя не должно никого запирать.
-- Токен ссылки хранится только как SHA-256 хеш (как у сброса пароля).

ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

CREATE TABLE email_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX idx_email_verifications_user ON email_verifications (user_id);
