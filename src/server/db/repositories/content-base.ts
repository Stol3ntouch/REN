import type { Db } from '../connection';

/**
 * Общая часть репозиториев контента (T08): таблицы с колонками snake_case, строки наружу — camelCase.
 * Список записываемых колонок задаёт сам репозиторий (белый список), значения только через параметры.
 */
const toSnake = (k: string): string => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (k: string): string => k.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

export type RepoConfig = {
  table: string;
  /** Записываемые поля (camelCase). */
  columns: readonly string[];
  /** Поля-флаги: в БД 0/1, в строке — boolean. */
  booleans?: readonly string[];
  /** Фрагмент ORDER BY. */
  order: string;
};

type Raw = Record<string, unknown>;

export function makeContentRepo<Row extends { id: number }, Write extends object>(cfg: RepoConfig) {
  const bools = new Set(cfg.booleans ?? []);
  const map = (r: Raw | undefined): Row | null => {
    if (!r) return null;
    const out: Raw = {};
    for (const [k, v] of Object.entries(r)) {
      const key = toCamel(k);
      out[key] = bools.has(key) ? v === 1 : v;
    }
    return out as unknown as Row;
  };
  const dbValue = (v: unknown): string | number | null => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v as string | number;
  };
  const known = (data: Write): string[] => cfg.columns.filter((c) => c in (data as Raw));

  return {
    list(db: Db, where = '', params: (string | number)[] = []): Row[] {
      const sql = `SELECT * FROM ${cfg.table} ${where ? `WHERE ${where}` : ''} ORDER BY ${cfg.order}`;
      return (db.prepare(sql).all(...params) as Raw[]).map((r) => map(r) as Row);
    },
    get(db: Db, id: number): Row | null {
      return map(db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(id) as Raw | undefined);
    },
    count(db: Db, where = '', params: (string | number)[] = []): number {
      const sql = `SELECT COUNT(*) AS n FROM ${cfg.table} ${where ? `WHERE ${where}` : ''}`;
      return (db.prepare(sql).get(...params) as { n: number }).n;
    },
    /** Запись по уникальному slug (для таблиц со slug). */
    findBySlug(db: Db, slug: string): Row | null {
      return map(db.prepare(`SELECT * FROM ${cfg.table} WHERE slug = ?`).get(slug) as Raw | undefined);
    },
    slugTaken(db: Db, slug: string, exceptId?: number): boolean {
      const r = db.prepare(`SELECT id FROM ${cfg.table} WHERE slug = ? AND id <> ?`).get(slug, exceptId ?? -1);
      return r !== undefined;
    },
    insert(db: Db, data: Write, now: number): number {
      const cols = known(data);
      const names = [...cols.map(toSnake), 'updated_at'];
      const marks = names.map(() => '?').join(', ');
      const values = [...cols.map((c) => dbValue((data as Raw)[c])), now];
      const r = db.prepare(`INSERT INTO ${cfg.table} (${names.join(', ')}) VALUES (${marks})`).run(...values);
      return Number(r.lastInsertRowid);
    },
    update(db: Db, id: number, data: Write, now: number): void {
      const cols = known(data);
      const sets = [...cols.map((c) => `${toSnake(c)} = ?`), 'updated_at = ?'].join(', ');
      db.prepare(`UPDATE ${cfg.table} SET ${sets} WHERE id = ?`).run(...cols.map((c) => dbValue((data as Raw)[c])), now, id);
    },
    remove(db: Db, id: number): void {
      db.prepare(`DELETE FROM ${cfg.table} WHERE id = ?`).run(id);
    },
  };
}
