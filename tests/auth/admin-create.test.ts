import { describe, expect, it } from 'vitest';
import { runAdminCreate } from '../../scripts/admin-create';
import { audit } from '@/domain/admin/audit';
import { loginStaff } from '@/domain/admin/staff';
import { verifyPassword } from '@/domain/customers/password';
import { createTestDb } from '@/server/db/testing';
import { fakeCookies, T0 } from './helpers';

const SECRET = 'S3cret-from-env-xyz';

function run(over: Partial<Parameters<typeof runAdminCreate>[0]> & { argv: string[] }) {
  const db = over.db ?? createTestDb();
  const lines: string[] = [];
  const errs: string[] = [];
  const done = runAdminCreate({
    env: {},
    promptPassword: null,
    out: (l) => lines.push(l),
    err: (l) => errs.push(l),
    db,
    now: T0,
    ...over,
  });
  return { db, lines, errs, done };
}

describe('npm run admin:create', () => {
  it('email из аргумента, пароль из ADMIN_PASSWORD: создаёт admin, пароль не печатается, вход работает', async () => {
    const { db, lines, errs, done } = run({ argv: ['Boss@Shop.test'], env: { ADMIN_PASSWORD: SECRET } });
    expect(await done).toBe(0);

    const row = db.prepare('SELECT email, role, password_hash FROM staff').get() as { email: string; role: string; password_hash: string };
    expect(row.email).toBe('boss@shop.test');
    expect(row.role).toBe('admin');
    expect(row.password_hash).not.toContain(SECRET);
    expect(await verifyPassword(SECRET, row.password_hash)).toBe(true);

    const output = [...lines, ...errs].join('\n');
    expect(output).not.toContain(SECRET);
    expect(output).not.toContain('boss@shop.test'); // email в выводе только замаскированным
    expect(output).toContain('b***@shop.test');

    expect((await loginStaff({ email: 'boss@shop.test', password: SECRET }, { db, cookies: fakeCookies(), ip: 'cli', now: T0 })).staffId).toBeGreaterThan(0);
    expect(audit.list({ action: 'staff.create' }, { db })).toHaveLength(1);
  });

  it('короткий логин из аргумента: создаётся, вход по логину без учёта регистра, в выводе замаскирован', async () => {
    const { db, lines, errs, done } = run({ argv: ['Adm'], env: { ADMIN_PASSWORD: SECRET } });
    expect(await done).toBe(0);
    expect(db.prepare('SELECT email FROM staff').get()).toEqual({ email: 'adm' });
    const output = [...lines, ...errs].join('\n');
    expect(output).not.toContain(SECRET);
    expect(output).toContain('a***m');
    expect(output).not.toMatch(/\badm\b/i);
    expect((await loginStaff({ email: 'ADM', password: SECRET }, { db, cookies: fakeCookies(), ip: 'cli', now: T0 })).staffId).toBeGreaterThan(0);
    expect(await run({ argv: ['a b'], env: { ADMIN_PASSWORD: SECRET } }).done).toBe(1);
  });

  it('без ADMIN_PASSWORD берёт пароль из интерактивного ввода', async () => {
    const { db, lines, done } = run({ argv: ['boss@shop.test'], promptPassword: async () => 'typed-password-123' });
    expect(await done).toBe(0);
    const row = db.prepare('SELECT password_hash FROM staff').get() as { password_hash: string };
    expect(await verifyPassword('typed-password-123', row.password_hash)).toBe(true);
    expect(lines.join('\n')).not.toContain('typed-password-123');
  });

  it('нет email, нет пароля, короткий пароль, дубль → код 1, ошибка по-русски, пароль не печатается', async () => {
    const noEmail = run({ argv: [], env: { ADMIN_PASSWORD: SECRET } });
    expect(await noEmail.done).toBe(1);
    expect(noEmail.errs.join('\n')).toMatch(/email/i);

    const noPassword = run({ argv: ['a@shop.test'] });
    expect(await noPassword.done).toBe(1);
    expect(noPassword.errs.join('\n')).toMatch(/ADMIN_PASSWORD/);

    const short = run({ argv: ['a@shop.test'], env: { ADMIN_PASSWORD: 'short' } });
    expect(await short.done).toBe(1);
    expect(short.errs.join('\n')).toMatch(/10/);
    expect(short.errs.join('\n')).not.toContain('short\n');

    const db = createTestDb();
    expect(await run({ db, argv: ['a@shop.test'], env: { ADMIN_PASSWORD: SECRET } }).done).toBe(0);
    const dup = run({ db, argv: ['a@shop.test'], env: { ADMIN_PASSWORD: SECRET } });
    expect(await dup.done).toBe(1);
    expect(dup.errs.join('\n')).not.toContain(SECRET);
    expect(db.prepare('SELECT COUNT(*) AS n FROM staff').get()).toEqual({ n: 1 });
  });
});
