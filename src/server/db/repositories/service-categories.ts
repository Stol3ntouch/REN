import type { Db } from '../connection';
import { makeContentRepo } from './content-base';

export type ServiceCategoryRow = { id: number; slug: string; name: string; sort: number; updatedAt: number };
export type ServiceCategoryWrite = Partial<Omit<ServiceCategoryRow, 'id' | 'updatedAt'>>;

const base = makeContentRepo<ServiceCategoryRow, ServiceCategoryWrite>({
  table: 'service_categories',
  columns: ['slug', 'name', 'sort'],
  order: 'sort, name, id',
});

export const serviceCategoriesRepo = {
  ...base,
  /** Сколько услуг ссылается на категорию. */
  usage(db: Db, id: number): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM services WHERE category_id = ?').get(id) as { n: number }).n;
  },
};
