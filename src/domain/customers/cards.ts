import { CARD_COLUMNS, CARD_JOIN, mapCard, type CardRow } from '@/domain/catalog/store';
import type { ProductCard } from '@/domain/catalog/types';
import type { Db } from '@/server/db/connection';

/**
 * Карточки опубликованных товаров по списку id — в том же порядке, что и ids.
 * Отступление от правила 4 (как и в domain/catalog/store.ts): читаем те же колонки, что витрина, без дублирования маппинга.
 */
export function cardsByIds(db: Db, ids: number[]): ProductCard[] {
  if (ids.length === 0) return [];
  const marks = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT ${CARD_COLUMNS} FROM products p ${CARD_JOIN} WHERE p.published = 1 AND p.id IN (${marks})`)
    .all(...ids) as CardRow[];
  const byId = new Map(rows.map((r) => [r.id, mapCard(r)]));
  return ids.flatMap((id) => {
    const card = byId.get(id);
    return card ? [card] : [];
  });
}
