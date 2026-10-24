import { getDb, type Db } from '@/server/db/connection';
import { bannersRepo, type BannerRow } from '@/server/db/repositories/banners';
import { companyReviewsRepo, type CompanyReviewRow } from '@/server/db/repositories/company-reviews';
import { newsRepo, type NewsRow } from '@/server/db/repositories/news';
import { newsCategoriesRepo, type NewsCategoryRow } from '@/server/db/repositories/news-categories';
import { pagesRepo, type PageRow } from '@/server/db/repositories/pages';
import { promotionsRepo, type PromotionRow } from '@/server/db/repositories/promotions';
import { serviceCategoriesRepo, type ServiceCategoryRow } from '@/server/db/repositories/service-categories';
import { servicesRepo, type ServiceRow } from '@/server/db/repositories/services';
import type { ListEntityKey } from './fields';

/**
 * Списки сущностей админки: серверный поиск, фильтр по статусу, сортировка и страницы.
 * Порядок и условия берутся из белых списков ниже — пользовательский ввод в SQL не попадает.
 */
export type AdminListParams = { q?: string; status?: string; sort?: string; dir?: 'asc' | 'desc'; page: number; pageSize: number };
export type AdminListResult<T> = { rows: T[]; total: number; page: number; pageSize: number };
type Row = PageRow | BannerRow | NewsRow | NewsCategoryRow | ServiceRow | ServiceCategoryRow | PromotionRow | CompanyReviewRow;

type Spec = {
  sorts: Record<string, string>;
  defaultSort: string;
  qColumns: string[];
  /** Фильтры по статусу: ключ → условие (now подставляется там, где сказано). */
  statuses?: Record<string, { sql: string; withNow?: boolean }>;
  search(db: Db, o: { where?: string; params?: (string | number)[]; q?: string; qColumns: string[]; orderBy: string; limit: number; offset: number }): { rows: Row[]; total: number };
};

const LIVE = (t: string) => `(${t}published = 1 AND (${t}published_at IS NULL OR ${t}published_at <= ?))`;
const publicationStatuses = (): Spec['statuses'] => ({
  draft: { sql: 'published = 0' },
  scheduled: { sql: 'published = 1 AND published_at IS NOT NULL AND published_at > ?', withNow: true },
  published: { sql: LIVE(''), withNow: true },
});

export const LIST_SPECS: Record<ListEntityKey, Spec> = {
  pages: {
    sorts: { title: 'title COLLATE NOCASE', slug: 'slug', updated: 'updated_at', published: 'published_at', sort: 'sort' },
    defaultSort: 'sort',
    qColumns: ['title', 'slug'],
    statuses: { ...publicationStatuses(), hidden: { sql: 'hidden_by_admin = 1' }, system: { sql: 'key IS NOT NULL' }, custom: { sql: 'key IS NULL' } },
    search: (db, o) => pagesRepo.search(db, o),
  },
  banners: {
    sorts: { title: 'title COLLATE NOCASE', position: 'position', sort: 'sort', starts: 'starts_at', updated: 'updated_at' },
    defaultSort: 'sort',
    qColumns: ['title', 'heading', 'url'],
    statuses: { active: { sql: "status = 'active'" }, inactive: { sql: "status = 'inactive'" }, hero: { sql: "position = 'home_hero'" }, category: { sql: "position = 'category'" }, strip: { sql: "position = 'top_strip'" }, middle: { sql: "position = 'home_middle'" } },
    search: (db, o) => bannersRepo.search(db, o),
  },
  news: {
    sorts: { title: 'title COLLATE NOCASE', published: 'COALESCE(published_at, updated_at)', updated: 'updated_at' },
    defaultSort: 'published',
    qColumns: ['title', 'slug', 'excerpt'],
    statuses: publicationStatuses(),
    search: (db, o) => newsRepo.search(db, o),
  },
  'news-categories': {
    sorts: { name: 'name COLLATE NOCASE', sort: 'sort' },
    defaultSort: 'sort',
    qColumns: ['name', 'slug'],
    search: (db, o) => newsCategoriesRepo.search(db, o),
  },
  services: {
    sorts: { title: 'title COLLATE NOCASE', sort: 'sort', updated: 'updated_at' },
    defaultSort: 'sort',
    qColumns: ['title', 'slug', 'summary'],
    statuses: { published: { sql: 'published = 1' }, hidden: { sql: 'published = 0' } },
    search: (db, o) => servicesRepo.search(db, o),
  },
  'service-categories': {
    sorts: { name: 'name COLLATE NOCASE', sort: 'sort' },
    defaultSort: 'sort',
    qColumns: ['name', 'slug'],
    search: (db, o) => serviceCategoriesRepo.search(db, o),
  },
  promotions: {
    sorts: { title: 'title COLLATE NOCASE', starts: 'starts_at', ends: 'ends_at', priority: 'priority', sort: 'sort', updated: 'updated_at' },
    defaultSort: 'sort',
    qColumns: ['title', 'slug', 'summary'],
    statuses: {
      draft: { sql: 'published = 0' },
      active: { sql: 'published = 1 AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?)', withNow: true },
      finished: { sql: 'published = 1 AND ends_at IS NOT NULL AND ends_at < ?', withNow: true },
      upcoming: { sql: 'published = 1 AND starts_at IS NOT NULL AND starts_at > ?', withNow: true },
    },
    search: (db, o) => promotionsRepo.search(db, o),
  },
  reviews: {
    sorts: { author: 'author_name COLLATE NOCASE', reviewed: 'COALESCE(reviewed_at, updated_at)', sort: 'sort' },
    defaultSort: 'sort',
    qColumns: ['author_name', 'body'],
    statuses: { published: { sql: 'published = 1' }, hidden: { sql: 'published = 0' } },
    search: (db, o) => companyReviewsRepo.search(db, o),
  },
};

export function listAdminEntity<K extends ListEntityKey>(entity: K, p: AdminListParams, opts: { db?: Db; now?: number } = {}): AdminListResult<Row> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const spec = LIST_SPECS[entity];
  const sortKey = p.sort && p.sort in spec.sorts ? p.sort : spec.defaultSort;
  const dir = p.dir === 'desc' ? 'DESC' : p.dir === 'asc' ? 'ASC' : sortKey === 'published' || sortKey === 'updated' ? 'DESC' : 'ASC';
  const orderBy = `${spec.sorts[sortKey]} ${dir}, id ${dir}`;
  const status = p.status ? spec.statuses?.[p.status] : undefined;
  const params: number[] = [];
  if (status?.withNow) for (let n = 0; n < (status.sql.match(/\?/g) ?? []).length; n++) params.push(now);
  const pageSize = Math.min(Math.max(p.pageSize, 1), 100);
  const page = Math.max(p.page, 1);
  const { rows, total } = spec.search(db, { where: status?.sql, params, q: p.q, qColumns: spec.qColumns, orderBy, limit: pageSize, offset: (page - 1) * pageSize });
  return { rows, total, page, pageSize };
}
