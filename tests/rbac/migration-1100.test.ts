import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@/server/db/connection';
import { runMigrations } from '@/server/db/migrate';
import { loadRolePermissions } from '@/domain/admin/role-permissions';

const MIGRATIONS = resolve(__dirname, '../../migrations');

/** Каталог с миграциями до C02 (< 1100): так выглядит рабочая БД перед обновлением. */
function legacyDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rts-mig-'));
  for (const f of readdirSync(MIGRATIONS)) if (/^\d{4}_/.test(f) && Number(f.slice(0, 4)) < 1100) copyFileSync(join(MIGRATIONS, f), join(dir, f));
  return dir;
}

function legacyDb(): { db: Db; dir: string } {
  const dir = legacyDir();
  const db = openDatabase(':memory:');
  runMigrations(db, { dir });
  return { db, dir };
}

const staffView = (db: Db) =>
  db.prepare('SELECT s.id, s.email, s.active, r.code AS role FROM staff s JOIN roles r ON r.id = s.role_id ORDER BY s.id').all();

describe('миграция 1100: staff.role → role_id', () => {
  it('сотрудники и сессии переезжают без потерь: admin→admin, manager→manager, id и сессии те же', () => {
    const { db, dir } = legacyDb();
    try {
      const ins = db.prepare("INSERT INTO staff (email, name, role, password_hash, active, created_at) VALUES (?, ?, ?, 'scrypt$x', ?, 1)");
      ins.run('admin', 'Первый', 'admin', 1);
      ins.run('mgr@shop.test', null, 'manager', 0);
      db.prepare("INSERT INTO staff_sessions (staff_id, token_hash, created_at, expires_at) VALUES (1, 'h1', 1, 9999999999999), (2, 'h2', 1, 9999999999999)").run();
      db.prepare("INSERT INTO audit_log (at, actor_id, actor_type, action, entity) VALUES (5, '1', 'staff', 'old.event', 'x')").run();

      runMigrations(db, { dir: MIGRATIONS });

      expect(staffView(db)).toEqual([
        { id: 1, email: 'admin', active: 1, role: 'admin' },
        { id: 2, email: 'mgr@shop.test', active: 0, role: 'manager' },
      ]);
      expect(db.prepare('SELECT staff_id FROM staff_sessions ORDER BY staff_id').all()).toEqual([{ staff_id: 1 }, { staff_id: 2 }]);
      expect(db.prepare("SELECT result, ip_hash FROM audit_log WHERE action = 'old.event'").get()).toEqual({ result: 'ok', ip_hash: null });
      // колонки role и её CHECK больше нет; новая роль вставляется
      expect(db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('staff') WHERE name = 'role'").get()).toEqual({ n: 0 });
      db.prepare("INSERT INTO roles (code, name, is_system, created_at) VALUES ('custom_t', 'Тест', 0, 1)").run();
      expect(() => db.prepare("INSERT INTO staff (email, role_id, password_hash, created_at) VALUES ('c', (SELECT id FROM roles WHERE code = 'custom_t'), 'h', 1)").run()).not.toThrow();
      // role_id обязателен (замена NOT NULL)
      expect(() => db.prepare("INSERT INTO staff (email, password_hash, created_at) VALUES ('d', 'h', 1)").run()).toThrow(/role_id/);
      // первый admin сохраняет все права, менеджер — свои
      expect(loadRolePermissions(db, (db.prepare('SELECT role_id FROM staff WHERE id = 1').get() as { role_id: number }).role_id, 'admin')).toContain('roles.manage');
      expect(db.prepare('SELECT COUNT(*) AS n FROM roles').get()).toEqual({ n: 7 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('назначения заказов не обнуляются (внешние ключи не срабатывают при миграции)', () => {
    const { db, dir } = legacyDb();
    try {
      db.prepare("INSERT INTO staff (email, role, password_hash, created_at) VALUES ('admin', 'admin', 'h', 1)").run();
      const cols = (db.prepare("SELECT name, \"notnull\" AS nn, dflt_value AS d FROM pragma_table_info('orders')").all() as { name: string; nn: number; d: string | null }[]).filter((c) => c.nn === 1 && c.d === null && c.name !== 'id');
      if (!cols.some((c) => c.name === 'guest_id')) cols.push({ name: 'guest_id', nn: 1, d: null });
      const values = cols.map((c) => (c.name === 'status' ? 'new' : c.name === 'guest_id' ? 'g1' : /(_at|kopecks|total|qty|count)$|^(id|version)$/.test(c.name) ? 1 : 'x'));
      db.prepare(`INSERT INTO orders (${cols.map((c) => c.name).join(', ')}, assigned_staff_id) VALUES (${cols.map(() => '?').join(', ')}, 1)`).run(...values);
      runMigrations(db, { dir: MIGRATIONS });
      expect(db.prepare('SELECT assigned_staff_id FROM orders').get()).toEqual({ assigned_staff_id: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('на копии рабочей БД data/rts.sqlite: миграция проходит, рабочий admin остаётся с полными правами', () => {
    const live = resolve(__dirname, '../../data/rts.sqlite');
    if (!existsSync(live)) return;
    const dir = mkdtempSync(join(tmpdir(), 'rts-copy-'));
    const copy = join(dir, 'copy.sqlite');
    mkdirSync(dir, { recursive: true });
    // Снимок через VACUUM INTO: живой файл только читается, копия самостоятельна.
    const src = new DatabaseSync(live, { readOnly: true });
    try {
      src.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
    } catch {
      src.close();
      rmSync(dir, { recursive: true, force: true });
      return; // рабочая БД занята или недоступна для снимка — остальные проверки миграции выше
    }
    src.close();
    const db = openDatabase(copy);
    try {
      const before = db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('staff') WHERE name = 'role'").get() as { n: number };
      const staffBefore = (db.prepare('SELECT COUNT(*) AS n FROM staff').get() as { n: number }).n;
      const sessionsBefore = (db.prepare('SELECT COUNT(*) AS n FROM staff_sessions').get() as { n: number }).n;
      runMigrations(db, { dir: MIGRATIONS });
      if (before.n === 1) {
        expect((db.prepare('SELECT COUNT(*) AS n FROM staff').get() as { n: number }).n).toBe(staffBefore);
        expect((db.prepare('SELECT COUNT(*) AS n FROM staff_sessions').get() as { n: number }).n).toBe(sessionsBefore);
        const admins = db.prepare("SELECT s.id FROM staff s JOIN roles r ON r.id = s.role_id WHERE r.code = 'admin' AND s.active = 1").all() as { id: number }[];
        for (const a of admins) expect(loadRolePermissions(db, (db.prepare('SELECT role_id FROM staff WHERE id = ?').get(a.id) as { role_id: number }).role_id, 'admin')).toContain('users.manage');
      }
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
