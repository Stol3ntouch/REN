-- C02: хранилище административных уведомлений. audience: 'all' | 'permission:<право>'.
CREATE TABLE admin_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                    -- order.created, request.created, import.failed …
  title TEXT NOT NULL,
  body TEXT,
  entity TEXT,
  entity_id TEXT,
  href TEXT,                             -- внутренняя ссылка /admin/…
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'error')),
  audience TEXT NOT NULL DEFAULT 'all',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_admin_notifications_created ON admin_notifications (created_at DESC, id DESC);
CREATE INDEX idx_admin_notifications_dedup ON admin_notifications (type, entity, entity_id, created_at);

-- Прочтение у каждого сотрудника своё.
CREATE TABLE admin_notification_reads (
  notification_id INTEGER NOT NULL REFERENCES admin_notifications(id) ON DELETE CASCADE,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (notification_id, staff_id)
) WITHOUT ROWID;
CREATE INDEX idx_admin_notification_reads_staff ON admin_notification_reads (staff_id);
