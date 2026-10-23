import { describe, expect, it } from 'vitest';
import { hasPermission } from '@/domain/admin/permissions';
import { ADMIN_NAV, visibleNav } from '@/ui/admin/nav';

const SECTIONS = [
  'Обзор',
  'Каталог',
  'Заказы',
  'Склад',
  'Цены и акции',
  'Покупатели',
  'Заявки',
  'Отзывы и вопросы',
  'Контент и услуги',
  'Импорт и интеграции',
  'Почта',
  'Аналитика',
  'Доступ и настройки',
];

describe('навигация админки', () => {
  it('разделы схемы в порядке схемы, у каждого уникальный путь под /admin', () => {
    expect(ADMIN_NAV.map((i) => i.label)).toEqual(SECTIONS);
    expect(new Set(ADMIN_NAV.map((i) => i.href)).size).toBe(ADMIN_NAV.length);
    expect(ADMIN_NAV.every((i) => i.href === '/admin' || i.href.startsWith('/admin/'))).toBe(true);
  });

  it('админ видит все разделы', () => {
    expect(visibleNav('admin').map((i) => i.label)).toEqual(SECTIONS);
  });

  it('менеджер видит только разделы, на которые у него есть право; остальное скрыто', () => {
    const labels = visibleNav('manager').map((i) => i.label);
    expect(labels).toEqual(['Обзор', 'Каталог', 'Заказы', 'Склад', 'Цены и акции', 'Покупатели', 'Заявки', 'Отзывы и вопросы', 'Импорт и интеграции']);
    for (const item of visibleNav('manager')) {
      expect(item.permission === null || hasPermission('manager', item.permission)).toBe(true);
    }
    expect(labels).not.toContain('Аналитика');
    expect(labels).not.toContain('Доступ и настройки');
    expect(labels).not.toContain('Контент и услуги');
    expect(labels).not.toContain('Почта');
  });
});
