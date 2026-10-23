import type { Db } from '@/server/db/connection';

/**
 * Источник популярности: возвращает SQL-подзапрос вида
 *   SELECT <product_id> AS id, SUM(<qty>) AS units FROM ... WHERE <не отменён> GROUP BY <product_id>
 * (единицы товара в неотменённых заказах) либо null, если заказов нет.
 * Таблицы заказов появятся с T05; он вызывает setPopularitySource(...) при старте.
 * Без источника сортировка «по популярности» вырождается в алфавитную.
 */
export type PopularitySource = (db: Db) => string | null;

// Состояние на globalThis: instrumentation и обработчики страниц Next.js — разные бандлы с разными экземплярами модуля.
const g = globalThis as unknown as { __rtsPopularity?: { source: PopularitySource | null } };
const state = (g.__rtsPopularity ??= { source: null });

export function setPopularitySource(src: PopularitySource | null): void {
  state.source = src;
}

export function getPopularitySql(db: Db): string | null {
  return state.source ? state.source(db) : null;
}
