import type { Db } from '@/server/db/connection';

/** Счётчик SQL-запросов и их времени: оборачивает соединение так, что репозитории ничего не замечают. */
export type StmtStat = { sql: string; count: number; ms: number; params: unknown[][] };
export type Probe = { db: Db; reset(): void; queries(): number; totalMs(): number; statements(): StmtStat[] };

export function probe(real: Db): Probe {
  const stats = new Map<string, StmtStat>();
  const record = (sql: string, params: unknown[], ms: number) => {
    const s = stats.get(sql) ?? { sql, count: 0, ms: 0, params: [] };
    s.count += 1;
    s.ms += ms;
    if (s.params.length < 3) s.params.push(params);
    stats.set(sql, s);
  };
  const wrapStmt = (stmt: ReturnType<Db['prepare']>, sql: string) =>
    new Proxy(stmt, {
      get(t, k) {
        const v = Reflect.get(t, k) as unknown;
        if (k === 'get' || k === 'all' || k === 'run' || k === 'iterate') {
          return (...args: unknown[]) => {
            const t0 = performance.now();
            try {
              return (v as (...a: unknown[]) => unknown).apply(t, args);
            } finally {
              record(sql, args, performance.now() - t0);
            }
          };
        }
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
  const db = new Proxy(real, {
    get(t, k) {
      const v = Reflect.get(t, k) as unknown;
      if (k === 'prepare') return (sql: string) => wrapStmt(t.prepare(sql), sql);
      if (k === 'exec') {
        return (sql: string) => {
          const t0 = performance.now();
          try {
            return t.exec(sql);
          } finally {
            record(`EXEC ${sql.slice(0, 40)}`, [], performance.now() - t0);
          }
        };
      }
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  }) as Db;
  const total = (f: (s: StmtStat) => number) => [...stats.values()].reduce((a, s) => a + f(s), 0);
  return {
    db,
    reset: () => stats.clear(),
    queries: () => total((s) => s.count),
    totalMs: () => total((s) => s.ms),
    statements: () => [...stats.values()],
  };
}

/** Выполняет `EXPLAIN QUERY PLAN` для захваченного запроса с его настоящими параметрами. */
export function planOf(real: Db, s: StmtStat): string[] {
  try {
    const rows = real.prepare(`EXPLAIN QUERY PLAN ${s.sql}`).all(...((s.params[0] ?? []) as never[])) as { detail: string }[];
    return rows.map((r) => r.detail);
  } catch {
    return [];
  }
}

export async function timed<T>(fn: () => Promise<T> | T): Promise<{ result: T; ms: number }> {
  const t0 = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - t0 };
}
