import { cache } from 'react';
import type { Db } from '@/server/db/connection';
import { categoriesRepo, type CategoryRow } from '@/server/db/repositories/categories';

/**
 * Все категории одним чтением на запрос: страница категории строит дерево, крошки, фильтры и поиск —
 * каждому нужен тот же список. В запросе React Server Components cache() отдаёт один и тот же результат
 * (ключ — соединение с БД); вне запроса (скрипты, тесты) работает как обычное чтение.
 */
const perRequest = cache((db: Db): CategoryRow[] => categoriesRepo.listAll(db));

export function listCategoryRows(db: Db): CategoryRow[] {
  return perRequest(db);
}
