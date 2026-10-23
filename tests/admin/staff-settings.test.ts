import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import { createStaff } from '@/domain/admin/staff';
import { auditOps } from '@/app/admin/(panel)/_lib/audit-ops';
import { settingsOps } from '@/app/admin/(panel)/_lib/settings-ops';
import { staffOps } from '@/app/admin/(panel)/_lib/staff-ops';
import { adminFlagsRepo } from '@/server/db/repositories/staff-admin';
import { createTestDb } from '@/server/db/testing';
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { admin, manager, T0 } from './helpers';

async function setup() {
  const db = createTestDb();
  const a = await createStaff({ email: 'boss@shop.test', password: 'admin-password-1', role: 'admin' }, { db, now: T0 });
  const m = await createStaff({ email: 'mgr@shop.test', password: 'manager-password-1', role: 'manager' }, { db, now: T0 });
  const boss = { ...admin, staffId: a.staffId };
  return { db, bossId: a.staffId, mgrId: m.staffId, boss };
}

describe('сотрудники', () => {
  it('менеджер и аноним не могут ничего: ни читать, ни создавать, ни менять', async () => {
    const { db, mgrId } = await setup();
    expect(() => staffOps.list(manager, { db })).toThrow(ForbiddenError);
    expect(() => staffOps.list(null, { db })).toThrow(UnauthorizedError);
    await expect(staffOps.create(manager, { email: 'x@shop.test', password: 'long-password-1', role: 'admin' }, { db })).rejects.toThrow(ForbiddenError);
    expect(() => staffOps.setRole(manager, mgrId, 'admin', { db })).toThrow(ForbiddenError);
    expect(() => staffOps.setActive(manager, mgrId, false, { db })).toThrow(ForbiddenError);
  });

  it('админ создаёт сотрудника, меняет роль и блокирует — всё в аудите, пароль в аудит не попадает', async () => {
    const { db, boss, mgrId } = await setup();
    const created = await staffOps.create(boss, { email: 'new@shop.test', password: 'brand-new-pass-1', role: 'manager', name: 'Новый' }, { db, now: T0 });
    staffOps.setRole(boss, created.staffId, 'admin', { db, now: T0 });
    staffOps.setActive(boss, mgrId, false, { db, now: T0 });
    const actions = audit.list({ entity: 'staff' }, { db }).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['staff.create', 'staff.role_change', 'staff.block']));
    expect(JSON.stringify(audit.list({}, { db }))).not.toContain('brand-new-pass-1');
    expect(staffOps.list(boss, { db }).find((s) => s.id === mgrId)).toMatchObject({ active: false });
  });

  it('нельзя снять права или заблокировать последнего администратора и заблокировать самого себя', async () => {
    const { db, boss, bossId } = await setup();
    expect(() => staffOps.setRole(boss, bossId, 'manager', { db })).toThrow(ConflictError);
    expect(() => staffOps.setActive(boss, bossId, false, { db })).toThrow(ConflictError);
    expect(staffOps.list(boss, { db }).find((s) => s.id === bossId)).toMatchObject({ role: 'admin', active: true });
  });

  it('при втором администраторе первого можно понизить; блокировка закрывает сессии', async () => {
    const { db, boss, bossId } = await setup();
    const second = await staffOps.create(boss, { email: 'second@shop.test', password: 'second-pass-123', role: 'admin' }, { db, now: T0 });
    db.prepare('INSERT INTO staff_sessions (staff_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)').run(second.staffId, 'h', T0, T0 + 1000);
    staffOps.setActive(boss, second.staffId, false, { db, now: T0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM staff_sessions WHERE staff_id = ?').get(second.staffId)).toEqual({ n: 0 });
    staffOps.setActive(boss, second.staffId, true, { db, now: T0 });
    staffOps.setRole({ ...boss, staffId: second.staffId }, bossId, 'manager', { db, now: T0 });
    expect(staffOps.list(boss, { db }).find((s) => s.id === bossId)?.role).toBe('manager');
  });

  it('роль вне admin|manager отвергается', async () => {
    const { db, boss, mgrId } = await setup();
    expect(() => staffOps.setRole(boss, mgrId, 'owner' as never, { db })).toThrow(ValidationError);
  });
});

describe('настройки админки', () => {
  it('менеджер не меняет и не читает настройки', async () => {
    const { db } = await setup();
    expect(() => settingsOps.get(manager, { db })).toThrow(ForbiddenError);
    expect(() => settingsOps.setManualEdit(manager, true, { db })).toThrow(ForbiddenError);
    expect(() => settingsOps.setRecipients(manager, 'a@b.ru', { db })).toThrow(ForbiddenError);
    expect(adminFlagsRepo.isManualEditEnabled(db)).toBe(false);
  });

  it('переключатель ручного редактирования хранится в admin_flags и аудируется (до/после)', async () => {
    const { db, boss } = await setup();
    settingsOps.setManualEdit(boss, true, { db, now: T0 });
    expect(adminFlagsRepo.get(db, 'catalog.manualEdit')).toBe('1');
    settingsOps.setManualEdit(boss, false, { db, now: T0 });
    const rows = audit.list({ entity: 'settings' }, { db });
    expect(rows.map((r) => r.action)).toEqual(['settings.manual_edit', 'settings.manual_edit']);
    expect(rows[1]).toMatchObject({ before: { enabled: false }, after: { enabled: true } });
  });

  it('получатели уведомлений: разбор списка, нижний регистр, без дублей; неверный адрес отвергает всё', async () => {
    const { db, boss } = await setup();
    const saved = settingsOps.setRecipients(boss, ' Shop@Example.com, boss@example.com\nshop@example.com ', { db, now: T0 });
    expect(saved).toEqual(['shop@example.com', 'boss@example.com']);
    expect(adminFlagsRepo.getRecipients(db)).toEqual(['shop@example.com', 'boss@example.com']);
    expect(() => settingsOps.setRecipients(boss, 'ok@example.com, not-an-email', { db, now: T0 })).toThrow(ValidationError);
    expect(adminFlagsRepo.getRecipients(db)).toEqual(['shop@example.com', 'boss@example.com']);
  });
});

describe('журнал аудита', () => {
  it('читать может только admin; фильтры и постраничность', async () => {
    const { db, boss } = await setup();
    for (let i = 0; i < 5; i++) audit.record({ actorId: 1, actorType: 'staff', action: i % 2 ? 'a.odd' : 'a.even', entity: 'thing', entityId: i }, { db, now: T0 + i });
    expect(() => auditOps.list(manager, {}, { db })).toThrow(ForbiddenError);
    expect(() => auditOps.list(null, {}, { db })).toThrow(UnauthorizedError);
    const odd = auditOps.list(boss, { action: 'a.odd' }, { db });
    expect(odd.rows.map((r) => r.entityId)).toEqual(['3', '1']);
    const p1 = auditOps.list(boss, { entity: 'thing', pageSize: 2 }, { db });
    const p3 = auditOps.list(boss, { entity: 'thing', pageSize: 2, page: 3 }, { db });
    expect(p1.rows).toHaveLength(2);
    expect(p1.hasNext).toBe(true);
    expect(p3.rows).toHaveLength(1);
    expect(p3.hasNext).toBe(false);
  });
});
