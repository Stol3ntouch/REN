-- C02: RBAC в БД. Роли и их права, staff.role (admin|manager) заменён ссылкой role_id.
--
-- Почему не «пересоздание таблицы staff»: staff_sessions (ON DELETE CASCADE) и orders.assigned_staff_id
-- (ON DELETE SET NULL) ссылаются на staff; DROP TABLE при включённых внешних ключах стёр бы сессии и
-- назначения менеджеров. ADD COLUMN + DROP COLUMN даёт тот же результат (колонка role с CHECK admin|manager
-- исчезает, данные сохранены, id сотрудников и сессии не меняются) без потери связанных строк.
-- Откат невозможен без бэкапа (npm run backup перед обновлением).

CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,              -- super_admin | admin | manager | content_manager | warehouse | service | custom_xxxx
  name TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at INTEGER NOT NULL             -- unix-мс
);
CREATE UNIQUE INDEX idx_roles_name ON roles (name);

-- Права роли. У super_admin строк нет: он получает все права автоматически.
CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
) WITHOUT ROWID;

-- Сид шести системных ролей (тот же состав, что SYSTEM_ROLES в src/domain/admin/permission-catalog.ts).
INSERT INTO roles (code, name, is_system, created_at) VALUES ('super_admin', 'Суперадминистратор', 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
INSERT INTO roles (code, name, is_system, created_at) VALUES ('admin', 'Администратор', 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
INSERT INTO roles (code, name, is_system, created_at) VALUES ('manager', 'Менеджер', 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
INSERT INTO roles (code, name, is_system, created_at) VALUES ('content_manager', 'Контент-менеджер', 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
INSERT INTO roles (code, name, is_system, created_at) VALUES ('warehouse', 'Сотрудник склада', 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
INSERT INTO roles (code, name, is_system, created_at) VALUES ('service', 'Специалист сервиса', 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

-- admin
INSERT INTO role_permissions (role_id, permission)
SELECT (SELECT id FROM roles WHERE code = 'admin'), p FROM (
          SELECT 'products.read' AS p
  UNION ALL SELECT 'products.write' AS p
  UNION ALL SELECT 'products.delete' AS p
  UNION ALL SELECT 'products.cost' AS p
  UNION ALL SELECT 'categories.write' AS p
  UNION ALL SELECT 'brands.write' AS p
  UNION ALL SELECT 'attributes.write' AS p
  UNION ALL SELECT 'filters.write' AS p
  UNION ALL SELECT 'warehouses.write' AS p
  UNION ALL SELECT 'catalog.read' AS p
  UNION ALL SELECT 'catalog.write' AS p
  UNION ALL SELECT 'import.run' AS p
  UNION ALL SELECT 'export.run' AS p
  UNION ALL SELECT 'orders.read' AS p
  UNION ALL SELECT 'orders.write' AS p
  UNION ALL SELECT 'orders.refund' AS p
  UNION ALL SELECT 'customers.read' AS p
  UNION ALL SELECT 'customers.write' AS p
  UNION ALL SELECT 'promos.write' AS p
  UNION ALL SELECT 'marketing.write' AS p
  UNION ALL SELECT 'inquiries.read' AS p
  UNION ALL SELECT 'inquiries.write' AS p
  UNION ALL SELECT 'requests.write' AS p
  UNION ALL SELECT 'repair.write' AS p
  UNION ALL SELECT 'reviews.moderate' AS p
  UNION ALL SELECT 'services.write' AS p
  UNION ALL SELECT 'content.write' AS p
  UNION ALL SELECT 'seo.write' AS p
  UNION ALL SELECT 'email.write' AS p
  UNION ALL SELECT 'settings.write' AS p
  UNION ALL SELECT 'payments.write' AS p
  UNION ALL SELECT 'shipping.write' AS p
  UNION ALL SELECT 'backup.run' AS p
  UNION ALL SELECT 'integrations.read' AS p
  UNION ALL SELECT 'integrations.run' AS p
  UNION ALL SELECT 'analytics.read' AS p
  UNION ALL SELECT 'stats.read' AS p
  UNION ALL SELECT 'finance.read' AS p
  UNION ALL SELECT 'users.manage' AS p
  UNION ALL SELECT 'staff.manage' AS p
  UNION ALL SELECT 'roles.manage' AS p
  UNION ALL SELECT 'audit.read' AS p
  UNION ALL SELECT 'notifications.read' AS p
  UNION ALL SELECT 'staff.self' AS p
);

-- manager
INSERT INTO role_permissions (role_id, permission)
SELECT (SELECT id FROM roles WHERE code = 'manager'), p FROM (
          SELECT 'orders.read' AS p
  UNION ALL SELECT 'orders.write' AS p
  UNION ALL SELECT 'requests.write' AS p
  UNION ALL SELECT 'reviews.moderate' AS p
  UNION ALL SELECT 'customers.read' AS p
  UNION ALL SELECT 'catalog.read' AS p
  UNION ALL SELECT 'integrations.read' AS p
  UNION ALL SELECT 'products.read' AS p
  UNION ALL SELECT 'inquiries.read' AS p
  UNION ALL SELECT 'inquiries.write' AS p
  UNION ALL SELECT 'repair.write' AS p
  UNION ALL SELECT 'notifications.read' AS p
  UNION ALL SELECT 'staff.self' AS p
);

-- content_manager
INSERT INTO role_permissions (role_id, permission)
SELECT (SELECT id FROM roles WHERE code = 'content_manager'), p FROM (
          SELECT 'content.write' AS p
  UNION ALL SELECT 'seo.write' AS p
  UNION ALL SELECT 'marketing.write' AS p
  UNION ALL SELECT 'reviews.moderate' AS p
  UNION ALL SELECT 'catalog.read' AS p
  UNION ALL SELECT 'products.read' AS p
  UNION ALL SELECT 'notifications.read' AS p
  UNION ALL SELECT 'staff.self' AS p
);

-- warehouse
INSERT INTO role_permissions (role_id, permission)
SELECT (SELECT id FROM roles WHERE code = 'warehouse'), p FROM (
          SELECT 'catalog.read' AS p
  UNION ALL SELECT 'products.read' AS p
  UNION ALL SELECT 'warehouses.write' AS p
  UNION ALL SELECT 'orders.read' AS p
  UNION ALL SELECT 'export.run' AS p
  UNION ALL SELECT 'notifications.read' AS p
  UNION ALL SELECT 'staff.self' AS p
);

-- service
INSERT INTO role_permissions (role_id, permission)
SELECT (SELECT id FROM roles WHERE code = 'service'), p FROM (
          SELECT 'requests.write' AS p
  UNION ALL SELECT 'inquiries.read' AS p
  UNION ALL SELECT 'inquiries.write' AS p
  UNION ALL SELECT 'repair.write' AS p
  UNION ALL SELECT 'services.write' AS p
  UNION ALL SELECT 'customers.read' AS p
  UNION ALL SELECT 'orders.read' AS p
  UNION ALL SELECT 'catalog.read' AS p
  UNION ALL SELECT 'products.read' AS p
  UNION ALL SELECT 'notifications.read' AS p
  UNION ALL SELECT 'staff.self' AS p
);


-- Сотрудники: роль теперь ссылка. Все существующие admin/manager переезжают в одноимённые роли.
ALTER TABLE staff ADD COLUMN role_id INTEGER REFERENCES roles(id);
UPDATE staff SET role_id = (SELECT id FROM roles WHERE code = staff.role);
ALTER TABLE staff DROP COLUMN role;

-- NOT NULL для role_id (ADD COLUMN с REFERENCES не принимает NOT NULL без значения по умолчанию).
CREATE TRIGGER staff_role_required_insert BEFORE INSERT ON staff
WHEN NEW.role_id IS NULL
BEGIN SELECT RAISE(ABORT, 'staff.role_id is required'); END;
CREATE TRIGGER staff_role_required_update BEFORE UPDATE OF role_id ON staff
WHEN NEW.role_id IS NULL
BEGIN SELECT RAISE(ABORT, 'staff.role_id is required'); END;
CREATE INDEX idx_staff_role ON staff (role_id);
