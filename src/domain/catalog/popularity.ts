import type { Db } from '@/server/db/connection';

/**
 * Источник популярности: возвращает SQL-подзапрос вида
 *   SELECT <product_id> AS id, SUM(<qty>) AS units FROM ... WHERE <не отменён> GROUP BY <product_id>
 * (единицы товара в неотменённых заказах) либо null, если заказов нет.
 * Таблицы заказов появятся с T05; он вызывает setPopularitySource(...) при старте.
 * Без источника сортировка «по популярности» вырождается в алфавитную.
 */
export type PopularitySource = (db: Db) => string | null;

let source: PopularitySource | null = null;

export function setPopularitySource(src: PopularitySource | null): void {
  source = src;
}

export function getPopularitySql(db: Db): string | null {
  return source ? source(db) : null;
}
