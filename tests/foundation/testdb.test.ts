import { describe, expect, it } from 'vitest';
import { withTransaction } from '@/server/db/connection';
import { getMigrationVersion } from '@/server/db/migrate';
import { createTestDb } from '@/server/db/testing';

describe('createTestDb', () => {
  it('даёт БД в памяти с применёнными миграциями проекта', () => {
    const db = createTestDb();
    expect(getMigrationVersion(db)).toBeGreaterThanOrEqual(1);
    const row = db.prepare("select name from sqlite_master where name = 'rate_limit'").get();
    expect(row).toBeTruthy();
  });

  it('базы разных вызовов изолированы друг от друга', () => {
    const a = createTestDb();
    const b = createTestDb();
    a.exec('create table probe (id integer)');
    expect(b.prepare("select name from sqlite_master where name = 'probe'").get()).toBeUndefined();
  });

  it('включает внешние ключи', () => {
    const db = createTestDb();
    expect((db.prepare('pragma foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
  });
});

describe('withTransaction', () => {
  it('фиксирует результат при успехе и возвращает значение', () => {
    const db = createTestDb();
    db.exec('create table t (id integer)');
    const out = withTransaction(db, (tx) => {
      tx.exec('insert into t values (1)');
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(db.prepare('select count(*) c from t').get()).toEqual({ c: 1 });
  });

  it('откатывает всё при исключении и пробрасывает его', () => {
    const db = createTestDb();
    db.exec('create table t (id integer)');
    expect(() =>
      withTransaction(db, (tx) => {
        tx.exec('insert into t values (1)');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.prepare('select count(*) c from t').get()).toEqual({ c: 0 });
  });

  it('вложенная транзакция откатывается отдельно от внешней', () => {
    const db = createTestDb();
    db.exec('create table t (id integer)');
    withTransaction(db, (tx) => {
      tx.exec('insert into t values (1)');
      expect(() =>
        withTransaction(tx, (inner) => {
          inner.exec('insert into t values (2)');
          throw new Error('inner');
        }),
      ).toThrow('inner');
    });
    expect(db.prepare('select id from t').all()).toEqual([{ id: 1 }]);
  });
});
