import type { Db } from '../../src/server/db/connection';
import { methodsRepo } from '../../src/server/db/repositories/methods';

/**
 * Способы получения и оплаты, промокоды: самовывоз, «по согласованию» и оплата при получении заведены миграцией 0300.
 * Здесь — только dev-метод «онлайн (ТЕСТ)» (выключен; T06 включает). В production не создаётся.
 */
export default function seedOrdering(db: Db): void {
  if (process.env.NODE_ENV === 'production') return;
  methodsRepo.insertOnlineTestIfMissing(db);
}
