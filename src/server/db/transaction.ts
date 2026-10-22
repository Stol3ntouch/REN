import type { Db } from './connection';

const depthByDb = new WeakMap<Db, number>();

/**
 * Выполняет fn в транзакции: успех → COMMIT, исключение → ROLLBACK и проброс.
 * Вложенный вызов использует SAVEPOINT. fn синхронна (node:sqlite синхронный).
 */
export function withTransaction<T>(db: Db, fn: (db: Db) => T): T {
  const depth = depthByDb.get(db) ?? 0;
  const begin = depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT sp_${depth}`;
  const commit = depth === 0 ? 'COMMIT' : `RELEASE sp_${depth}`;
  const rollback = depth === 0 ? 'ROLLBACK' : `ROLLBACK TO sp_${depth}; RELEASE sp_${depth}`;

  db.exec(begin);
  depthByDb.set(db, depth + 1);
  try {
    const result = fn(db);
    db.exec(commit);
    return result;
  } catch (e) {
    db.exec(rollback);
    throw e;
  } finally {
    depthByDb.set(db, depth);
  }
}
