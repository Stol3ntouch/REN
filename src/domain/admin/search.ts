import { hasPermission, type Permission, type StaffSession } from '@/domain/admin/permissions';
import { getDb, type Db } from '@/server/db/connection';
import { SEARCH_MIN_CHARS, SEARCH_PER_TYPE, searchAdminRepo } from '@/server/db/repositories/search-admin';
import { UnauthorizedError } from '@/server/http/errors';

export { SEARCH_MIN_CHARS, SEARCH_PER_TYPE };
export const SEARCH_MAX_TOTAL = 25;
export const SEARCH_MAX_QUERY = 100;
/** Бюджет времени на весь поиск: группы, на которые времени не хватило, пропускаются (partial = true). */
export const SEARCH_TIMEOUT_MS = 800;

export type SearchGroupKey = 'products' | 'categories' | 'orders' | 'customers' | 'inquiries';
export type SearchItem = { title: string; subtitle: string | null; href: string };
export type SearchGroup = { key: SearchGroupKey; label: string; items: SearchItem[] };
export type SearchResult = { query: string; groups: SearchGroup[]; total: number; partial: boolean };

type Source = { key: SearchGroupKey; label: string; permission: Permission; run: (db: Db, q: string, limit: number) => SearchItem[] };

const SOURCES: Source[] = [
  {
    key: 'products',
    label: 'Товары',
    permission: 'products.read',
    run: (db, q, n) =>
      searchAdminRepo.products(db, q, n).map((p) => ({
        title: p.name,
        subtitle: [p.sku ? `Артикул ${p.sku}` : null, p.published ? null : 'не опубликован'].filter(Boolean).join(' · ') || null,
        href: `/admin/catalog/${p.id}`,
      })),
  },
  {
    key: 'categories',
    label: 'Категории',
    permission: 'products.read',
    run: (db, q, n) => searchAdminRepo.categories(db, q, n).map((c) => ({ title: c.name, subtitle: null, href: `/admin/catalog/categories/${c.id}` })),
  },
  {
    key: 'orders',
    label: 'Заказы',
    permission: 'orders.read',
    run: (db, q, n) => searchAdminRepo.orders(db, q, n).map((o) => ({ title: `Заказ ${o.number}`, subtitle: o.contactName, href: `/admin/orders/${encodeURIComponent(o.number)}` })),
  },
  {
    key: 'customers',
    label: 'Клиенты',
    permission: 'customers.read',
    run: (db, q, n) => searchAdminRepo.customers(db, q, n).map((c) => ({ title: c.name?.trim() || c.email, subtitle: c.name ? c.email : null, href: `/admin/customers/${c.id}` })),
  },
  {
    key: 'inquiries',
    label: 'Обращения',
    permission: 'inquiries.read',
    run: (db, q, n) => searchAdminRepo.inquiries(db, q, n).map((r) => ({ title: r.number ? `${r.number} · ${r.name}` : r.name, subtitle: null, href: `/admin/inquiries/${r.id}` })),
  },
];

/** Нормализация запроса: пробелы по краям и внутри, обрезка по длине. */
export function normalizeQuery(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_QUERY) : '';
}

/**
 * Глобальный поиск админки. Тип объектов, на который у сотрудника нет права, НЕ запрашивается вообще
 * (ни запроса к БД, ни пустой группы в ответе). ≤5 результатов на тип, итого ≤25; запрос короче 2 символов → пусто.
 */
export function globalSearch(session: StaffSession | null, rawQuery: unknown, opts: { db?: Db; now?: () => number; timeoutMs?: number } = {}): SearchResult {
  if (!session) throw new UnauthorizedError('Требуется вход в админку');
  const query = normalizeQuery(rawQuery);
  const empty: SearchResult = { query, groups: [], total: 0, partial: false };
  if ([...query].length < SEARCH_MIN_CHARS) return empty;

  const db = opts.db ?? getDb();
  const clock = opts.now ?? Date.now;
  const started = clock();
  const budget = opts.timeoutMs ?? SEARCH_TIMEOUT_MS;
  const groups: SearchGroup[] = [];
  let total = 0;
  let partial = false;
  for (const src of SOURCES) {
    if (!hasPermission(session, src.permission)) continue;
    if (clock() - started > budget || total >= SEARCH_MAX_TOTAL) {
      partial = true;
      break;
    }
    const items = src.run(db, query, Math.min(SEARCH_PER_TYPE, SEARCH_MAX_TOTAL - total));
    if (items.length === 0) continue;
    groups.push({ key: src.key, label: src.label, items });
    total += items.length;
  }
  return { query, groups, total, partial };
}
