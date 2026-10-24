import { describe, expect, it } from 'vitest';
import { hasPermission } from '@/domain/admin/permissions';
import { ADMIN_NAV, ADMIN_NAV_GROUPS, visibleNav, visibleNavGroups } from '@/ui/admin/nav';

/** Меню зафиксировано в interfaces.md → «CMS-админка»: группы, подписи и адреса. */
const GROUPS = ['Каталог', 'Продажи', 'Контент', 'Услуги', 'Настройки'];
const ADMIN_LABELS = [
  'Панель управления',
  'Товары',
  'Категории',
  'Бренды',
  'Характеристики',
  'Фильтры',
  'Импорт / Экспорт',
  'Склад',
  'Заказы',
  'Клиенты',
  'Обращения',
  'Аналитика',
  'Страницы',
  'Баннеры',
  'Новости',
  'Акции',
  'Купоны',
  'Отзывы',
  'Услуги и ремонт',
  'Заявки на ремонт',
  'Настройки магазина',
  'Доставка и оплата',
  'Пользователи',
  'Интеграции',
  'Почта',
  'Резервные копии',
  'Логи',
];

describe('навигация админки', () => {
  it('группы и пункты схемы в порядке схемы, у каждого уникальный путь под /admin', () => {
    expect(ADMIN_NAV_GROUPS.map((g) => g.label).filter(Boolean)).toEqual(GROUPS);
    expect(ADMIN_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label))).toEqual(ADMIN_LABELS);
    expect(new Set(ADMIN_NAV.map((i) => i.href)).size).toBe(ADMIN_NAV.length);
    expect(ADMIN_NAV.every((i) => i.href === '/admin' || i.href.startsWith('/admin/'))).toBe(true);
  });

  it('админ видит все пункты', () => {
    expect(visibleNav('admin').map((i) => i.label)).toEqual(ADMIN_LABELS);
  });

  it('менеджер видит только пункты, на которые у него есть право; остальное скрыто', () => {
    const labels = visibleNav('manager').map((i) => i.label);
    expect(labels).toEqual([
      'Панель управления',
      'Товары',
      'Категории',
      'Бренды',
      'Характеристики',
      'Фильтры',
      'Импорт / Экспорт',
      'Склад',
      'Заказы',
      'Клиенты',
      'Обращения',
      'Купоны',
      'Отзывы',
      'Заявки на ремонт',
      'Интеграции',
    ]);
    for (const item of visibleNav('manager')) {
      expect(item.permission === null || hasPermission('manager', item.permission)).toBe(true);
    }
    for (const hidden of ['Аналитика', 'Пользователи', 'Страницы', 'Почта', 'Логи', 'Настройки магазина']) expect(labels).not.toContain(hidden);
  });

  it('вложенные пункты тоже скрываются по правам', () => {
    const settings = visibleNavGroups('admin').flatMap((g) => g.items).find((i) => i.key === 'store-settings');
    expect(settings?.children?.map((c) => c.label)).toEqual(['Налоги и цены', 'SEO', 'Служебные настройки']);
    expect(visibleNavGroups('manager').flatMap((g) => g.items).some((i) => i.key === 'store-settings')).toBe(false);
  });

  it('у менеджера нет пустых групп', () => {
    for (const g of visibleNavGroups('manager')) expect(g.items.length).toBeGreaterThan(0);
    expect(visibleNavGroups('manager').map((g) => g.label)).toEqual([null, 'Каталог', 'Продажи', 'Контент', 'Услуги', 'Настройки']);
  });
});
