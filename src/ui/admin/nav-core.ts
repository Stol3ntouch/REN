import type { Permission } from '@/domain/admin/permissions';
import type { AdminIconName } from './kit/icons';

/**
 * Меню админки (структура и адреса зафиксированы в interfaces.md → «CMS-админка»).
 *
 * Как добавить или обновить пункт: правьте ADMIN_NAV_GROUPS ниже (key, label, href, icon, permission).
 * Страница пункта — `src/app/admin/(panel)/<путь>/page.tsx`, первой строкой `requireStaffPage(permission)`.
 * Пока страницы нет, у пункта стоит `pending: true`: ссылка ведёт на `interim.href` (старая работающая страница,
 * если она есть) либо на общую заглушку `[...soon]`, которая честно пишет «Раздел появится после завершения сборки».
 * Тикет-владелец страницы удаляет `pending` и `interim` — и пункт становится обычным.
 * Скрытие пункта по правам — только удобство: страницы и обработчики сами проверяют права на сервере.
 */
export type AdminNavLeaf = {
  key: string;
  label: string;
  /** Итоговый адрес раздела. */
  href: string;
  /** Право, при котором пункт показан (null — любому сотруднику). */
  permission: Permission | null;
  /** Страница ещё не сдана своим тикетом. */
  pending?: boolean;
  /** Пока pending: существующая страница, на которую ведёт ссылка меню и которую заглушка предлагает открыть. */
  interim?: { href: string; label: string };
  /** Другие адреса, на которых этот пункт подсвечен как активный (старые маршруты). */
  aliases?: readonly string[];
};

export type AdminNavItem = AdminNavLeaf & {
  icon: AdminIconName;
  children?: readonly AdminNavLeaf[];
};

export type AdminNavGroup = {
  key: string;
  /** Заголовок группы; null — группа без заголовка («Главная»). */
  label: string | null;
  items: readonly AdminNavItem[];
};

export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    key: 'main',
    label: null,
    items: [{ key: 'dashboard', label: 'Панель управления', href: '/admin', icon: 'home', permission: null }],
  },
  {
    key: 'catalog',
    label: 'Каталог',
    items: [
      { key: 'products', label: 'Товары', href: '/admin/catalog', icon: 'box', permission: 'catalog.read' },
      { key: 'categories', label: 'Категории', href: '/admin/catalog/categories', icon: 'grid', permission: 'catalog.read' },
      { key: 'brands', label: 'Бренды', href: '/admin/catalog/brands', icon: 'tag', permission: 'catalog.read' },
      { key: 'attributes', label: 'Характеристики', href: '/admin/catalog/attributes', icon: 'list', permission: 'catalog.read' },
      { key: 'filters', label: 'Фильтры', href: '/admin/catalog/filters', icon: 'sliders', permission: 'catalog.read' },
      { key: 'import', label: 'Импорт / Экспорт', href: '/admin/import', icon: 'transfer', permission: 'integrations.read' },
      { key: 'warehouse', label: 'Склад', href: '/admin/warehouse', icon: 'warehouse', permission: 'catalog.read' },
    ],
  },
  {
    key: 'sales',
    label: 'Продажи',
    items: [
      { key: 'orders', label: 'Заказы', href: '/admin/orders', icon: 'cart', permission: 'orders.read' },
      { key: 'customers', label: 'Клиенты', href: '/admin/customers', icon: 'users', permission: 'customers.read' },
      {
        key: 'inquiries',
        label: 'Обращения',
        href: '/admin/inquiries',
        icon: 'message',
        permission: 'inquiries.read',
        aliases: ['/admin/requests', '/admin/questions'],
      },
      { key: 'analytics', label: 'Аналитика', href: '/admin/analytics', icon: 'chart', permission: 'analytics.read' },
    ],
  },
  {
    key: 'content',
    label: 'Контент',
    items: [
      { key: 'pages', label: 'Страницы', href: '/admin/content/pages', icon: 'file', permission: 'content.write', aliases: ['/admin/content'] },
      {
        key: 'banners',
        label: 'Баннеры',
        href: '/admin/content/banners',
        icon: 'image',
        permission: 'content.write',
        aliases: ['/admin/content/slides'],
      },
      { key: 'news', label: 'Новости', href: '/admin/content/news', icon: 'news', permission: 'content.write' },
      { key: 'promotions', label: 'Акции', href: '/admin/content/promotions', icon: 'gift', permission: 'content.write' },
      { key: 'promos', label: 'Купоны', href: '/admin/promos', icon: 'percent', permission: 'catalog.read' },
      { key: 'reviews', label: 'Отзывы', href: '/admin/reviews', icon: 'star', permission: 'reviews.moderate' },
    ],
  },
  {
    key: 'services',
    label: 'Услуги',
    items: [
      { key: 'services', label: 'Услуги и ремонт', href: '/admin/content/services', icon: 'wrench', permission: 'content.write' },
      {
        key: 'repairs',
        label: 'Заявки на ремонт',
        href: '/admin/repairs',
        icon: 'clipboard',
        permission: 'repair.write',
      },
    ],
  },
  {
    key: 'settings',
    label: 'Настройки',
    items: [
      {
        key: 'store-settings',
        label: 'Настройки магазина',
        href: '/admin/settings/store',
        icon: 'settings',
        permission: 'settings.write',
        interim: { href: '/admin/content/settings', label: 'Настройки сайта' },
        aliases: ['/admin/content/settings'],
        children: [
          { key: 'taxes', label: 'Налоги и цены', href: '/admin/settings/taxes', permission: 'settings.write' },
          { key: 'seo', label: 'SEO', href: '/admin/settings/seo', permission: 'seo.write' },
          { key: 'service-settings', label: 'Служебные настройки', href: '/admin/settings', permission: 'settings.write' },
        ],
      },
      { key: 'shipping', label: 'Доставка и оплата', href: '/admin/settings/shipping', icon: 'truck', permission: 'shipping.write', aliases: ['/admin/settings/payments'] },
      { key: 'staff', label: 'Пользователи', href: '/admin/staff', icon: 'user', permission: 'users.manage' },
      { key: 'roles', label: 'Роли', href: '/admin/roles', icon: 'shield', permission: 'roles.manage' },
      { key: 'integrations', label: 'Интеграции', href: '/admin/integrations', icon: 'plug', permission: 'integrations.read' },
      { key: 'mail', label: 'Почта', href: '/admin/settings/email', icon: 'mail', permission: 'email.write', aliases: ['/admin/mail'] },
      { key: 'backup', label: 'Резервные копии', href: '/admin/settings/backup', icon: 'database', permission: 'backup.run' },
      { key: 'audit', label: 'Логи', href: '/admin/audit', icon: 'history', permission: 'audit.read' },
    ],
  },
];

/** Страницы, которых нет в меню, но которые есть в админке (для хлебных крошек). */
export const ADMIN_EXTRA_PAGES: Readonly<Record<string, string>> = {
  '/admin/profile': 'Профиль',
  '/admin/staff/new': 'Новый пользователь',
};

/** Флаги верхней панели: поиск и уведомления включены (C10). Выключенный флаг ничего фиктивного не показывает. */
export const TOPBAR_FEATURES = { search: true, notifications: true } as const;

/** Пункт меню вместе с родителем — плоский вид для поиска и тестов. */
export type NavEntry = AdminNavLeaf & { icon?: AdminIconName; parentKey: string | null; groupKey: string };

export const ADMIN_NAV_ENTRIES: readonly NavEntry[] = ADMIN_NAV_GROUPS.flatMap((g) =>
  g.items.flatMap((item): NavEntry[] => [
    { ...item, parentKey: null, groupKey: g.key },
    ...(item.children ?? []).map((c): NavEntry => ({ ...c, parentKey: item.key, groupKey: g.key })),
  ]),
);

/** Все пункты (верхнего уровня и вложенные) — плоским списком. Совместимо с прежним `ADMIN_NAV`. */
export const ADMIN_NAV: readonly NavEntry[] = ADMIN_NAV_ENTRIES;

/** Куда ведёт ссылка меню: у несданной страницы — на существующую `interim`, иначе на итоговый адрес. */
export function navTarget(leaf: AdminNavLeaf): string {
  return leaf.pending && leaf.interim ? leaf.interim.href : leaf.href;
}

/** Адреса, на которых пункт считается активным. */
export function navMatchHrefs(leaf: AdminNavLeaf): string[] {
  return [leaf.href, ...(leaf.interim ? [leaf.interim.href] : []), ...(leaf.aliases ?? [])];
}

const norm = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** Совпадение пути с адресом: '/admin' — только точно, остальные — сам адрес и всё под ним. */
function matchLength(pathname: string, href: string): number {
  const path = norm(pathname);
  const h = norm(href);
  if (h === '/admin') return path === '/admin' ? h.length : 0;
  return path === h || path.startsWith(`${h}/`) ? h.length : 0;
}

/** Активный пункт для адреса: самое длинное совпадение среди всех адресов пунктов (учитываются interim и aliases). */
export function findActiveEntry(pathname: string, entries: readonly AdminNavLeaf[] = ADMIN_NAV_ENTRIES): AdminNavLeaf | null {
  let best: AdminNavLeaf | null = null;
  let bestLen = 0;
  for (const e of entries) {
    for (const h of navMatchHrefs(e)) {
      const len = matchLength(pathname, h);
      if (len > bestLen) {
        best = e;
        bestLen = len;
      }
    }
  }
  return best;
}

export type Crumb = { label: string; href?: string };

/** Хлебные крошки по адресу: Главная › [родитель ›] раздел › остаток пути (id, номер). Последняя крошка без ссылки. */
export function buildBreadcrumbs(pathname: string): Crumb[] {
  const path = norm(pathname);
  const home: Crumb = { label: 'Главная', href: '/admin' };
  if (path === '/admin' || !path.startsWith('/admin')) return [{ label: 'Главная' }];
  const extra = ADMIN_EXTRA_PAGES[path];
  if (extra) return [home, { label: extra }];

  const entry = findActiveEntry(path);
  if (!entry) return [home, { label: decodeSegment(path.split('/').pop() ?? '') }];
  const crumbs: Crumb[] = [home];
  const full = ADMIN_NAV_ENTRIES.find((e) => e.key === entry.key);
  const parent = full?.parentKey ? ADMIN_NAV_ENTRIES.find((e) => e.key === full.parentKey) : null;
  if (parent) crumbs.push({ label: parent.label, href: navTarget(parent) });
  const matched = navMatchHrefs(entry).sort((a, b) => matchLength(path, b) - matchLength(path, a))[0] ?? entry.href;
  const rest = norm(path).slice(norm(matched).length).split('/').filter(Boolean);
  crumbs.push(rest.length > 0 ? { label: entry.label, href: navTarget(entry) } : { label: entry.label });
  rest.forEach((seg, i) => crumbs.push(i === rest.length - 1 ? { label: decodeSegment(seg) } : { label: decodeSegment(seg), href: `${norm(matched)}/${rest.slice(0, i + 1).join('/')}` }));
  return crumbs;
}

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Пункт меню по точному адресу (итоговому, interim или alias) — для заглушки `[...soon]`. */
export function findNavEntryByPath(pathname: string): NavEntry | null {
  const path = norm(pathname);
  return ADMIN_NAV_ENTRIES.find((e) => norm(e.href) === path) ?? null;
}
