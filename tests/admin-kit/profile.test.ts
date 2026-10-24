import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { profileOps } from '@/app/admin/(panel)/profile/profile-ops';
import { audit } from '@/domain/admin/audit';
import { createStaff } from '@/domain/admin/staff';
import { getStaffSession } from '@/domain/admin/staff-session';
import type { StaffSession } from '@/domain/admin/permissions';
import { verifyPassword } from '@/domain/customers/password';
import { hashToken } from '@/domain/customers/session';
import type { Db } from '@/server/db/connection';
import { createTestDb } from '@/server/db/testing';
import { sessionsRepo } from '@/server/db/repositories/sessions';
import { staffRepo } from '@/server/db/repositories/staff';
import { RateLimitError, UnauthorizedError, ValidationError } from '@/server/http/errors';

const NOW = Date.UTC(2026, 9, 24, 12);
const OLD = 'old-password-1';
const NEW = 'brand-new-password-2';

async function setup(role: 'admin' | 'manager' = 'manager') {
  const db = createTestDb();
  const { staffId } = await createStaff({ email: 'worker', password: OLD, role }, { db, now: NOW });
  const session: StaffSession = { staffId, email: 'worker', name: null, role };
  for (const token of ['current', 'other-1', 'other-2']) {
    sessionsRepo.insert(db, 'staff', { ownerId: staffId, tokenHash: hashToken(token), now: NOW, expiresAt: NOW + 3_600_000 });
  }
  return { db, session, staffId };
}

const alive = (db: Db, token: string) => getStaffSession({ get: () => ({ value: token }) }, { db, now: NOW + 1000 }) !== null;
const ctx = (db: Db, now = NOW) => ({ db, now, keepTokenHash: hashToken('current') });

describe('профиль: смена своего пароля', () => {
  it('успех: пароль сменён, остальные сессии закрыты, текущая жива, в аудите нет пароля', async () => {
    const { db, session, staffId } = await setup();
    const r = await profileOps.changePassword(session, { current: OLD, next: NEW, confirm: NEW }, ctx(db));
    expect(r.closedSessions).toBe(2);
    expect(alive(db, 'current')).toBe(true);
    expect(alive(db, 'other-1')).toBe(false);
    expect(alive(db, 'other-2')).toBe(false);
    const row = staffRepo.findById(db, staffId)!;
    expect(await verifyPassword(NEW, row.passwordHash)).toBe(true);
    expect(await verifyPassword(OLD, row.passwordHash)).toBe(false);
    const entry = audit.list({ entity: 'staff', action: 'staff.password_change' }, { db });
    expect(entry).toHaveLength(1);
    expect(JSON.stringify(entry[0])).not.toContain(NEW);
    expect(JSON.stringify(entry[0])).not.toContain(OLD);
  });

  it('неверный текущий пароль — ошибка поля, пароль и сессии не тронуты', async () => {
    const { db, session, staffId } = await setup();
    const err = await profileOps.changePassword(session, { current: 'wrong-password', next: NEW, confirm: NEW }, ctx(db)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fields?.current).toBeDefined();
    expect(await verifyPassword(OLD, staffRepo.findById(db, staffId)!.passwordHash)).toBe(true);
    expect(alive(db, 'other-1')).toBe(true);
  });

  it('новый пароль короче 10 символов, не совпадает с повтором или равен текущему — отказ', async () => {
    const { db, session } = await setup();
    await expect(profileOps.changePassword(session, { current: OLD, next: 'short', confirm: 'short' }, ctx(db))).rejects.toThrow('не короче 10');
    await expect(profileOps.changePassword(session, { current: OLD, next: NEW, confirm: `${NEW}x` }, ctx(db))).rejects.toThrow('Пароли не совпадают');
    await expect(profileOps.changePassword(session, { current: OLD, next: OLD, confirm: OLD }, ctx(db))).rejects.toThrow('отличаться');
  });

  it('без сессии — 401; профиль доступен роли без особых прав (достаточно войти)', async () => {
    const { db, session } = await setup('manager');
    await expect(profileOps.changePassword(null, { current: OLD, next: NEW, confirm: NEW }, ctx(db))).rejects.toBeInstanceOf(UnauthorizedError);
    expect(() => profileOps.get(null, { db })).toThrow(UnauthorizedError);
    expect(profileOps.get(session, { db })).toMatchObject({ email: 'worker', role: 'manager' });
  });

  it('перебор текущего пароля ограничен: после 10 попыток за окно — 429', async () => {
    const { db, session } = await setup();
    for (let i = 0; i < 10; i += 1) {
      await expect(profileOps.changePassword(session, { current: 'wrong-password', next: NEW, confirm: NEW }, ctx(db))).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(profileOps.changePassword(session, { current: OLD, next: NEW, confirm: NEW }, ctx(db))).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe('профиль: имя', () => {
  it('сохраняется обрезанным и пишется в аудит; пустое — убирает имя', async () => {
    const { db, session, staffId } = await setup();
    profileOps.updateName(session, { name: '  Анна Иванова ' }, { db, now: NOW });
    expect(staffRepo.findById(db, staffId)!.name).toBe('Анна Иванова');
    expect(audit.list({ entity: 'staff', action: 'staff.profile_update' }, { db })).toHaveLength(1);
    profileOps.updateName(session, { name: '' }, { db, now: NOW });
    expect(staffRepo.findById(db, staffId)!.name).toBeNull();
  });

  it('без изменений аудит не пишется; слишком длинное имя и отсутствие сессии — отказ', async () => {
    const { db, session } = await setup();
    profileOps.updateName(session, { name: '' }, { db, now: NOW });
    expect(audit.list({ action: 'staff.profile_update' }, { db })).toHaveLength(0);
    expect(() => profileOps.updateName(session, { name: 'я'.repeat(101) }, { db })).toThrow(ValidationError);
    expect(() => profileOps.updateName(null, { name: 'x' }, { db })).toThrow(UnauthorizedError);
  });
});

describe('защита и каркас', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

  it('страница профиля требует вход (requireStaffPage), а админка целиком закрыта от индексации', () => {
    expect(read('src/app/admin/(panel)/profile/page.tsx')).toMatch(/requireStaffPage\(null\)/);
    expect(read('src/app/admin/layout.tsx')).toMatch(/robots:\s*\{\s*index:\s*false/);
  });

  it('каркас вставляется только при наличии сессии сотрудника (вход остаётся вне каркаса)', () => {
    const layout = read('src/app/admin/layout.tsx');
    expect(layout).toMatch(/if \(!session\) return <>\{children\}<\/>/);
    expect(layout).toContain('<AdminLayout');
  });
});
