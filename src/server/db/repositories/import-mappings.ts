import type { Db } from '../connection';

export type ImportMappingRow = { id: number; name: string; mapping: Record<string, string>; createdBy: number | null; createdAt: string; updatedAt: string };

type Raw = { id: number; name: string; mapping: string; created_by: number | null; created_at: string; updated_at: string };

function parse(json: string): Record<string, string> {
  try {
    const v: unknown = JSON.parse(json);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}

const map = (r: Raw): ImportMappingRow => ({ id: r.id, name: r.name, mapping: parse(r.mapping), createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });

/** Пресеты сопоставления колонок. Имя уникально без учёта регистра: повторное сохранение с тем же именем заменяет пресет. */
export const importMappingsRepo = {
  list(db: Db): ImportMappingRow[] {
    return (db.prepare('SELECT * FROM import_mappings ORDER BY name COLLATE NOCASE, id').all() as Raw[]).map(map);
  },

  get(db: Db, id: number): ImportMappingRow | undefined {
    const r = db.prepare('SELECT * FROM import_mappings WHERE id = ?').get(id) as Raw | undefined;
    return r && map(r);
  },

  save(db: Db, name: string, mapping: Record<string, string>, actorId: number | null, now: string): number {
    const found = db.prepare('SELECT id FROM import_mappings WHERE name = ? COLLATE NOCASE').get(name) as { id: number } | undefined;
    if (found) {
      db.prepare('UPDATE import_mappings SET name = ?, mapping = ?, updated_at = ? WHERE id = ?').run(name, JSON.stringify(mapping), now, found.id);
      return found.id;
    }
    const r = db.prepare('INSERT INTO import_mappings (name, mapping, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(name, JSON.stringify(mapping), actorId, now, now);
    return Number(r.lastInsertRowid);
  },

  delete(db: Db, id: number): boolean {
    return Number(db.prepare('DELETE FROM import_mappings WHERE id = ?').run(id).changes) > 0;
  },
};
