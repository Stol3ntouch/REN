/**
 * Каталог прав и системных ролей. Единственный источник списка: из него строятся тип Permission,
 * матрица флажков на /admin/roles и сид ролей (миграция 1100 содержит ту же раскладку — это проверяет тест).
 * Файл без импортов: его можно прочитать и из миграционных скриптов.
 */

export type PermissionDef = { key: string; label: string; legacy?: boolean; baseline?: boolean };
export type PermissionGroupDef = { key: string; label: string; permissions: readonly PermissionDef[] };

export const PERMISSION_GROUPS = [
  {
    key: 'catalog',
    label: 'Каталог',
    permissions: [
      { key: 'products.read', label: 'Просмотр товаров' },
      { key: 'products.write', label: 'Создание и редактирование товаров' },
      { key: 'products.delete', label: 'Удаление товаров' },
      { key: 'products.cost', label: 'Закупочные цены товаров' },
      { key: 'categories.write', label: 'Категории' },
      { key: 'brands.write', label: 'Бренды' },
      { key: 'attributes.write', label: 'Характеристики' },
      { key: 'filters.write', label: 'Фильтры каталога' },
      { key: 'warehouses.write', label: 'Склады и остатки' },
      { key: 'catalog.read', label: 'Каталог: просмотр (общее право)', legacy: true },
      { key: 'catalog.write', label: 'Каталог: изменение (общее право)', legacy: true },
    ],
  },
  {
    key: 'transfer',
    label: 'Импорт и экспорт',
    permissions: [
      { key: 'import.run', label: 'Импорт данных' },
      { key: 'export.run', label: 'Экспорт данных' },
    ],
  },
  {
    key: 'sales',
    label: 'Продажи',
    permissions: [
      { key: 'orders.read', label: 'Просмотр заказов' },
      { key: 'orders.write', label: 'Управление заказами' },
      { key: 'orders.refund', label: 'Возвраты по заказам' },
      { key: 'customers.read', label: 'Просмотр клиентов' },
      { key: 'customers.write', label: 'Изменение клиентов' },
      { key: 'promos.write', label: 'Купоны', legacy: true },
      { key: 'marketing.write', label: 'Акции и маркетинг' },
    ],
  },
  {
    key: 'service',
    label: 'Обращения и сервис',
    permissions: [
      { key: 'inquiries.read', label: 'Просмотр обращений' },
      { key: 'inquiries.write', label: 'Работа с обращениями' },
      { key: 'requests.write', label: 'Заявки и обращения (общее право)', legacy: true },
      { key: 'repair.write', label: 'Заявки на ремонт' },
      { key: 'reviews.moderate', label: 'Модерация отзывов' },
      { key: 'services.write', label: 'Услуги и ремонт' },
    ],
  },
  {
    key: 'content',
    label: 'Контент и SEO',
    permissions: [
      { key: 'content.write', label: 'Страницы, баннеры, новости' },
      { key: 'seo.write', label: 'SEO и метаданные' },
      { key: 'email.write', label: 'Email-шаблоны и уведомления' },
    ],
  },
  {
    key: 'settings',
    label: 'Настройки',
    permissions: [
      { key: 'settings.write', label: 'Изменение настроек магазина' },
      { key: 'payments.write', label: 'Настройки оплаты' },
      { key: 'shipping.write', label: 'Настройки доставки' },
      { key: 'backup.run', label: 'Резервные копии' },
    ],
  },
  {
    key: 'integrations',
    label: 'Интеграции',
    permissions: [
      { key: 'integrations.read', label: 'Просмотр интеграций' },
      { key: 'integrations.run', label: 'Управление интеграциями' },
    ],
  },
  {
    key: 'finance',
    label: 'Аналитика и финансы',
    permissions: [
      { key: 'analytics.read', label: 'Аналитика', legacy: true },
      { key: 'stats.read', label: 'Статистика' },
      { key: 'finance.read', label: 'Финансовые данные' },
    ],
  },
  {
    key: 'admin',
    label: 'Администрирование',
    permissions: [
      { key: 'users.manage', label: 'Управление пользователями' },
      { key: 'staff.manage', label: 'Управление сотрудниками (общее право)', legacy: true },
      { key: 'roles.manage', label: 'Управление ролями и правами' },
      { key: 'audit.read', label: 'Журнал действий' },
      { key: 'notifications.read', label: 'Уведомления' },
      { key: 'staff.self', label: 'Свой профиль и пароль', baseline: true },
    ],
  },
] as const satisfies readonly PermissionGroupDef[];

type Groups = typeof PERMISSION_GROUPS;
export type Permission = Groups[number]['permissions'][number]['key'];

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key as Permission));

/** Права, которые есть у любого сотрудника с ролью: не редактируются матрицей. */
export const BASELINE_PERMISSIONS: readonly Permission[] = ['staff.self'];

/** Права, которые можно отмечать флажками (без базовых). */
export const EDITABLE_PERMISSIONS: readonly Permission[] = ALL_PERMISSIONS.filter((p) => !BASELINE_PERMISSIONS.includes(p));

const KNOWN = new Set<string>(ALL_PERMISSIONS);
export const isPermission = (v: unknown): v is Permission => typeof v === 'string' && KNOWN.has(v);

export const PERMISSION_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => [p.key, p.label])),
);

export const SUPER_ADMIN_CODE = 'super_admin';

export type SystemRoleSeed = { code: string; name: string; permissions: readonly Permission[] };

/** Права менеджера, как были до RBAC в БД (7 штук), плюс точные аналоги новых ключей. */
const MANAGER: readonly Permission[] = [
  'orders.read',
  'orders.write',
  'requests.write',
  'reviews.moderate',
  'customers.read',
  'catalog.read',
  'integrations.read',
  'products.read',
  'inquiries.read',
  'inquiries.write',
  'repair.write',
  'notifications.read',
  'staff.self',
];

/** Шесть ролей по умолчанию. super_admin прав в таблице не хранит: получает все автоматически. */
export const SYSTEM_ROLES: readonly SystemRoleSeed[] = [
  { code: SUPER_ADMIN_CODE, name: 'Суперадминистратор', permissions: ALL_PERMISSIONS },
  { code: 'admin', name: 'Администратор', permissions: ALL_PERMISSIONS },
  { code: 'manager', name: 'Менеджер', permissions: MANAGER },
  {
    code: 'content_manager',
    name: 'Контент-менеджер',
    permissions: ['content.write', 'seo.write', 'marketing.write', 'reviews.moderate', 'catalog.read', 'products.read', 'notifications.read', 'staff.self'],
  },
  {
    code: 'warehouse',
    name: 'Сотрудник склада',
    permissions: ['catalog.read', 'products.read', 'warehouses.write', 'orders.read', 'export.run', 'notifications.read', 'staff.self'],
  },
  {
    code: 'service',
    name: 'Специалист сервиса',
    permissions: [
      'requests.write',
      'inquiries.read',
      'inquiries.write',
      'repair.write',
      'services.write',
      'customers.read',
      'orders.read',
      'catalog.read',
      'products.read',
      'notifications.read',
      'staff.self',
    ],
  },
];

/** Права системной роли «из кода» (запасной вариант для сессий без загруженного набора, например в тестах). */
export const ROLE_PERMISSIONS: Readonly<Record<string, readonly Permission[]>> = Object.fromEntries(SYSTEM_ROLES.map((r) => [r.code, r.permissions]));
