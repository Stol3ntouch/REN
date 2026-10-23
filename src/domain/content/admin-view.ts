import { getDb, type Db } from '@/server/db/connection';
import { companyReviewsRepo } from '@/server/db/repositories/company-reviews';
import { newsRepo } from '@/server/db/repositories/news';
import { pagesRepo } from '@/server/db/repositories/pages';
import { promotionsRepo } from '@/server/db/repositories/promotions';
import { servicesRepo } from '@/server/db/repositories/services';
import { slidesRepo } from '@/server/db/repositories/slides';
import type { EntityKey } from './fields';
import { getSettings } from './settings';

/** Строка списка в админке: подпись, пометка и запись целиком (значения для формы правки; имена полей = поля формы). */
export type AdminItem = { id: number; title: string; note: string; record: Record<string, unknown> };

const yn = (v: boolean, yes: string, no: string) => (v ? yes : no);

export function listAdminItems(entity: Exclude<EntityKey, 'settings'>, opts: { db?: Db } = {}): AdminItem[] {
  const db = opts.db ?? getDb();
  switch (entity) {
    case 'pages':
      return pagesRepo.list(db).map((r) => ({ id: r.id, title: r.title, note: `/${r.slug}${r.legalDraft ? ' · черновик, проверить юристом' : ''}`, record: { ...r } }));
    case 'slides':
      return slidesRepo.list(db).map((r) => ({ id: r.id, title: r.title, note: yn(r.active, 'показывается', 'скрыт'), record: { ...r } }));
    case 'news':
      return newsRepo.list(db).map((r) => ({ id: r.id, title: r.title, note: `${yn(r.published, 'опубликована', 'черновик')} · /${r.slug}`, record: { ...r } }));
    case 'services':
      return servicesRepo.list(db).map((r) => ({ id: r.id, title: r.title, note: `${yn(r.published, 'опубликована', 'скрыта')} · /${r.slug}`, record: { ...r } }));
    case 'promotions':
      return promotionsRepo.list(db).map((r) => ({ id: r.id, title: r.title, note: `${yn(r.published, 'опубликована', 'скрыта')} · /${r.slug}`, record: { ...r } }));
    case 'reviews':
      return companyReviewsRepo.list(db).map((r) => ({ id: r.id, title: `${r.authorName}: ${r.body.slice(0, 60)}`, note: yn(r.published, 'опубликован', 'скрыт'), record: { ...r } }));
  }
}

export function getSettingsRecord(opts: { db?: Db } = {}): Record<string, string> {
  return getSettings({ db: opts.db });
}
