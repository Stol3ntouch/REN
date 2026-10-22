import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '@/server/db/connection';
import { getMigrationVersion, runMigrations } from '@/server/db/migrate';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rts-mig-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, sql: string) => writeFileSync(join(dir, name), sql);
const tables = (db: ReturnType<typeof openDatabase>) =>
  (db.prepare("select name from sqlite_master where type='table' order by name").all() as { name: string }[]).map((r) => r.name);

describe('runMigrations', () => {
  it('применяет файлы по номерам, повторный запуск ничего не меняет', () => {
    write('0002_b.sql', 'create table b (id integer primary key);');
    write('0001_a.sql', 'create table a (id integer primary key);');
    const db = openDatabase(':memory:');

    const first = runMigrations(db, { dir });
    expect(first.applied).toEqual(['0001_a', '0002_b']);
    expect(first.version).toBe(2);
    expect(tables(db)).toEqual(expect.arrayContaining(['a', 'b']));

    const second = runMigrations(db, { dir });
    expect(second.applied).toEqual([]);
    expect(second.version).toBe(2);
    expect(getMigrationVersion(db)).toBe(2);
  });

  it('до первого запуска версия равна 0', () => {
    expect(getMigrationVersion(openDatabase(':memory:'))).toBe(0);
  });

  it('применяет «опоздавшую» миграцию с меньшим номером (параллельные таски)', () => {
    write('0001_a.sql', 'create table a (id integer);');
    write('0003_c.sql', 'create table c (id integer);');
    const db = openDatabase(':memory:');
    runMigrations(db, { dir });

    write('0002_b.sql', 'create table b (id integer);');
    const res = runMigrations(db, { dir });
    expect(res.applied).toEqual(['0002_b']);
    expect(res.version).toBe(3);
    expect(tables(db)).toContain('b');
  });

  it('падающая миграция откатывается целиком и не записывается', () => {
    write('0001_a.sql', 'create table a (id integer);');
    write('0002_bad.sql', 'create table x (id integer); insert into no_such_table values (1);');
    const db = openDatabase(':memory:');

    expect(() => runMigrations(db, { dir })).toThrow(/0002_bad/);
    expect(tables(db)).not.toContain('x');
    expect(getMigrationVersion(db)).toBe(1);
  });

  it('отказывает, если уже применённый файл изменили', () => {
    write('0001_a.sql', 'create table a (id integer);');
    const db = openDatabase(':memory:');
    runMigrations(db, { dir });

    write('0001_a.sql', 'create table a (id integer, extra text);');
    expect(() => runMigrations(db, { dir })).toThrow(/0001_a/);
  });

  it('перевод строк CRLF/LF не считается изменением файла', () => {
    write('0001_a.sql', 'create table a (\n  id integer\n);\n');
    const db = openDatabase(':memory:');
    runMigrations(db, { dir });

    write('0001_a.sql', 'create table a (\r\n  id integer\r\n);\r\n');
    expect(() => runMigrations(db, { dir })).not.toThrow();
  });

  it('отказывает на файле с неверным именем и на дублях номера', () => {
    write('init.sql', 'select 1;');
    expect(() => runMigrations(openDatabase(':memory:'), { dir })).toThrow(/init\.sql/);

    rmSync(join(dir, 'init.sql'));
    write('0001_a.sql', 'select 1;');
    write('0001_b.sql', 'select 1;');
    expect(() => runMigrations(openDatabase(':memory:'), { dir })).toThrow(/0001/);
  });

  it('на файловой БД повторный запуск тоже ничего не меняет', () => {
    write('0001_a.sql', 'create table a (id integer);');
    const db = openDatabase(join(dir, 'rts.sqlite'));
    runMigrations(db, { dir });
    const before = db.prepare('select applied_at from schema_migrations').all();
    runMigrations(db, { dir });
    expect(db.prepare('select applied_at from schema_migrations').all()).toEqual(before);
    db.close();
  });
});
