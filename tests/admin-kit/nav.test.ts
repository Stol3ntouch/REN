import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_NAV_ENTRIES, ADMIN_NAV_GROUPS, buildBreadcrumbs, findActiveEntry, findNavEntryByPath, navTarget, TOPBAR_FEATURES, visibleNavGroups } from '@/ui/admin/nav';

const PANEL = resolve(__dirname, '../../src/app/admin/(panel)');

/** Файл страницы для адреса: статические папки в приоритете, затем динамические [param]; catch-all [...x] не считается. */
function pageFile(href: string): string | null {
  const segments = href.split('/').filter(Boolean).slice(1); // без «admin»
  const walk = (dir: string, rest: string[]): string | null => {
    if (rest.length === 0) return existsSync(join(dir, 'page.tsx')) ? join(dir, 'page.tsx') : null;
    const [head, ...tail] = rest as [string, ...string[]];
    if (existsSync(join(dir, head))) {
      const hit = walk(join(dir, head), tail);
      if (hit) return hit;
    }
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (d.isDirectory() && /^\[[^.\]]+\]$/.test(d.name)) {
        const hit = walk(join(dir, d.name), tail);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(PANEL, segments);
}

const isStub = (file: string): boolean => readFileSync(file, 'utf8').includes('<SoonView');

describe('меню админки: каждый пункт ведёт на настоящую страницу или на честную заглушку', () => {
  it('пункты без метки pending имеют настоящую страницу в src/app/admin/(panel), а не заглушку', () => {
    const bad = ADMIN_NAV_ENTRIES.filter((e) => {
      if (e.pending) return false;
      const f = pageFile(e.href);
      return !f || isStub(f);
    }).map((e) => e.href);
    expect(bad).toEqual([]);
  });

  it('у пунктов pending страницы нет или это заглушка SoonView (сдал страницу — снимите pending и interim в nav-core.ts)', () => {
    const stale = ADMIN_NAV_ENTRIES.filter((e) => {
      if (!e.pending) return false;
      const f = pageFile(e.href);
      return f !== null && !isStub(f);
    }).map((e) => e.href);
    expect(stale).toEqual([]);
  });

  it('pending-пункт не уходит в 404: либо страница-заглушка по адресу, либо ни одного динамического маршрута, перехватывающего адрес', () => {
    for (const e of ADMIN_NAV_ENTRIES.filter((x) => x.pending)) {
      const f = pageFile(e.href);
      // Адрес без собственной страницы обслуживает [...soon]; но тогда его не должен перехватить динамический [param]-маршрут.
      expect(f === null || isStub(f), e.href).toBe(true);
    }
  });

  it('ссылка pending-пункта ведёт на существующую страницу interim, а без неё — на адрес заглушки', () => {
    for (const e of ADMIN_NAV_ENTRIES.filter((x) => x.pending)) {
      const target = navTarget(e);
      if (e.interim) expect(pageFile(target), `${e.key} → ${target}`).not.toBeNull();
      else expect(target).toBe(e.href);
    }
  });

  it('заглушка находит пункт по адресу', () => {
    expect(findNavEntryByPath('/admin/catalog/brands/')?.key).toBe('brands');
    expect(findNavEntryByPath('/admin/nope')).toBeNull();
  });
});

describe('активный пункт и хлебные крошки', () => {
  it('выбирается самое длинное совпадение: /admin/catalog/categories/5 — «Категории», а не «Товары»', () => {
    expect(findActiveEntry('/admin/catalog/categories/5')?.key).toBe('categories');
    expect(findActiveEntry('/admin/catalog/217')?.key).toBe('products');
    expect(findActiveEntry('/admin')?.key).toBe('dashboard');
    expect(findActiveEntry('/admin/orders/RTS-000123')?.key).toBe('orders');
  });

  it('старые адреса подсвечивают свой пункт (aliases, interim)', () => {
    expect(findActiveEntry('/admin/requests')?.key).toBe('inquiries');
    expect(findActiveEntry('/admin/questions')?.key).toBe('inquiries');
    expect(findActiveEntry('/admin/content/slides')?.key).toBe('banners');
    expect(findActiveEntry('/admin/content')?.key).toBe('pages');
    expect(findActiveEntry('/admin/settings')?.key).toBe('service-settings');
  });

  it('неизвестный адрес не подсвечивает ничего', () => {
    expect(findActiveEntry('/admin/unknown')).toBeNull();
    expect(findActiveEntry('/other')).toBeNull();
  });

  it('крошки: Главная › раздел › остаток пути; последняя без ссылки', () => {
    expect(buildBreadcrumbs('/admin')).toEqual([{ label: 'Главная' }]);
    expect(buildBreadcrumbs('/admin/orders')).toEqual([{ label: 'Главная', href: '/admin' }, { label: 'Заказы' }]);
    expect(buildBreadcrumbs('/admin/orders/RTS-000123')).toEqual([
      { label: 'Главная', href: '/admin' },
      { label: 'Заказы', href: '/admin/orders' },
      { label: 'RTS-000123' },
    ]);
    expect(buildBreadcrumbs('/admin/settings/taxes')).toEqual([
      { label: 'Главная', href: '/admin' },
      { label: 'Настройки магазина', href: '/admin/settings/store' },
      { label: 'Налоги и цены' },
    ]);
    expect(buildBreadcrumbs('/admin/profile')).toEqual([{ label: 'Главная', href: '/admin' }, { label: 'Профиль' }]);
  });
});

describe('конфигурация верхней панели', () => {
  it('поиск и уведомления выключены, пока их не включит C10', () => {
    expect(TOPBAR_FEATURES).toEqual({ search: false, notifications: false });
  });

  it('все группы меню из схемы присутствуют, у пунктов есть иконки', () => {
    expect(ADMIN_NAV_GROUPS.every((g) => g.items.every((i) => typeof i.icon === 'string'))).toBe(true);
    expect(visibleNavGroups('admin').length).toBe(ADMIN_NAV_GROUPS.length);
  });
});
