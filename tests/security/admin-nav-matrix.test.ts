import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, ROLE_PERMISSIONS, SUPER_ADMIN_CODE, SYSTEM_ROLES } from '@/domain/admin/permission-catalog';
import { canStats } from '@/domain/analytics/stats';
import { hasPermission, type Permission, type StaffSession } from '@/domain/admin/permissions';
import { ADMIN_NAV, visibleNav } from '@/ui/admin/nav';

/**
 * Матрица «роль × страница», сгенерированная из ROLE_PERMISSIONS и ADMIN_NAV (а не вручную):
 *  — для каждого пункта меню читается ФАКТИЧЕСКОЕ право, которое проверяет его page.tsx (requireStaffPage);
 *  — пункт виден роли ⇒ страница ей открывается (меню не ведёт в редирект «нет прав»);
 *  — страница закрыта роли без права (прямой запрос → редирект на обзор), даже когда пункт скрыт.
 */
const PANEL = resolve(__dirname, '../../src/app/admin/(panel)');

function pageFile(href: string): string | null {
  const segments = href.split('/').filter(Boolean).slice(1);
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

/** Право из первой строки requireStaffPage('…') страницы; без аргумента — null («достаточно входа»). */
function pageGuard(href: string): Permission | null {
  const file = pageFile(href);
  expect(file, `у пункта ${href} нет page.tsx`).not.toBeNull();
  const src = readFileSync(file as string, 'utf8');
  const m = /requireStaffPage\(\s*(?:'([a-z_.]+)')?\s*\)/.exec(src);
  expect(m, `${href}: не найден вызов requireStaffPage`).not.toBeNull();
  const perm = m![1];
  if (!perm) return null;
  expect(ALL_PERMISSIONS, `${href}: право ${perm} не из каталога`).toContain(perm);
  return perm as Permission;
}

/** Страницы, которые по смыслу открыты любому вошедшему сотруднику: панель управления (виджеты сами фильтруются правами). */
const OPEN_TO_ANY_STAFF = new Set(['/admin']);
/** Страницы с проверкой права внутри (canStats: stats.read ИЛИ analytics.read). */
const CUSTOM_CHECK: Record<string, (s: StaffSession) => boolean> = { '/admin/analytics': canStats };

const session = (role: string): StaffSession => ({ staffId: 1, email: 'x', name: null, role });
const ROLES = SYSTEM_ROLES.map((r) => r.code);

/** Открывается ли страница пункта сотруднику роли (по фактической защите страницы). */
function pageOpens(href: string, role: string): boolean {
  const s = session(role);
  if (CUSTOM_CHECK[href]) return CUSTOM_CHECK[href]!(s);
  const guard = pageGuard(href);
  return guard === null ? true : hasPermission(s, guard);
}

describe('матрица роль × страница админки', () => {
  it('в меню есть пункты и роли (проверка не пустая)', () => {
    expect(ADMIN_NAV.length).toBeGreaterThanOrEqual(28);
    expect(ROLES).toEqual(['super_admin', 'admin', 'manager', 'content_manager', 'warehouse', 'service']);
  });

  it('право, которое проверяет страница, существует; страницы без права — только панель и явные исключения', () => {
    const open = ADMIN_NAV.filter((e) => pageGuard(e.href) === null && !CUSTOM_CHECK[e.href]).map((e) => e.href);
    expect(open.filter((h) => !OPEN_TO_ANY_STAFF.has(h))).toEqual([]);
  });

  for (const role of ROLES) {
    describe(`роль ${role}`, () => {
      it('каждый видимый в меню пункт открывается этой роли (меню не ведёт на отказ)', () => {
        const dead = visibleNav(role)
          .flatMap((i) => [i, ...(i.children ?? [])])
          .filter((e) => !pageOpens(e.href, role))
          .map((e) => e.href);
        expect(dead).toEqual([]);
      });

      it('страница закрыта, если права у роли нет: прямой запрос не открывает пункт, скрытый в меню', () => {
        for (const e of ADMIN_NAV) {
          const visible = visibleNav(role)
            .flatMap((i) => [i, ...(i.children ?? [])])
            .some((v) => v.href === e.href);
          if (!visible && e.permission) {
            // пункт скрыт из-за отсутствия права: страница не должна открываться по прямой ссылке
            expect(pageOpens(e.href, role), `${role} → ${e.href}`).toBe(hasPermission(session(role), e.permission) ? true : false);
          }
        }
      });
    });
  }

  it('суперадминистратор открывает все страницы; роли без прав — ни одной, кроме панели', () => {
    for (const e of ADMIN_NAV) expect(pageOpens(e.href, SUPER_ADMIN_CODE), e.href).toBe(true);
    for (const e of ADMIN_NAV) expect(pageOpens(e.href, 'нет такой роли'), e.href).toBe(OPEN_TO_ANY_STAFF.has(e.href));
  });

  it('несколько показательных ячеек матрицы совпадают с ожиданием владельца', () => {
    expect(pageOpens('/admin/orders', 'manager')).toBe(true);
    expect(pageOpens('/admin/orders', 'content_manager')).toBe(false);
    expect(pageOpens('/admin/content/pages', 'content_manager')).toBe(true);
    expect(pageOpens('/admin/content/pages', 'warehouse')).toBe(false);
    expect(pageOpens('/admin/warehouse', 'warehouse')).toBe(true);
    expect(pageOpens('/admin/repairs', 'service')).toBe(true);
    expect(pageOpens('/admin/roles', 'admin')).toBe(true);
    expect(pageOpens('/admin/roles', 'manager')).toBe(false);
    expect(pageOpens('/admin/settings/backup', 'manager')).toBe(false);
    expect(pageOpens('/admin/staff', 'service')).toBe(false);
    expect(ROLE_PERMISSIONS.manager).not.toContain('roles.manage');
  });
});
