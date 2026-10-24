-- C02: журнал действий получает результат и сведения о запросе (только хеши, без IP/UA в открытом виде).
-- Триггеры «только добавление» из 0200 остаются: ADD COLUMN их не затрагивает; старые записи читаются как result = 'ok'.
ALTER TABLE audit_log ADD COLUMN result TEXT NOT NULL DEFAULT 'ok' CHECK (result IN ('ok', 'denied', 'error'));
ALTER TABLE audit_log ADD COLUMN ip_hash TEXT;
ALTER TABLE audit_log ADD COLUMN ua_hash TEXT;

CREATE INDEX idx_audit_actor_at ON audit_log (actor_id, at);
CREATE INDEX idx_audit_action_at ON audit_log (action, at);
CREATE INDEX idx_audit_result_at ON audit_log (result, at);
