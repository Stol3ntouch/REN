import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import { listForStaff } from '@/domain/admin/notifications';
import type { StaffSession } from '@/domain/admin/permissions';
import { inquiriesOps, parseRequestFilters, repairsOps } from '@/domain/requests/sales-admin';
import { submitCallback, submitContact, submitRepair } from '@/domain/requests/service';
import { REPAIR_STATUSES, REPAIR_TRANSITIONS, canRepairTransition } from '@/domain/requests/workflow';
import { requestsRepo } from '@/server/db/repositories/requests';
import { createTestDb } from '@/server/db/testing';
import { admin, manager } from '../admin/helpers';

const T0 = Date.UTC(2026, 9, 22, 12);
const service: StaffSession = { staffId: 3, email: 's@x.test', name: 'Сервис', role: 'service' };
const warehouse: StaffSession = { staffId: 4, email: 'w@x.test', name: 'Склад', role: 'warehouse' };
const tmp = mkdtempSync(join(tmpdir(), 'rts-c09-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function setup() {
  const db = createTestDb();
  db.prepare(
    "INSERT INTO staff (id, email, name, role_id, password_hash, created_at) VALUES (1, 'boss@shop.test', 'Админ', (SELECT id FROM roles WHERE code = 'admin'), 'x', 1), (2, 'mgr@shop.test', 'Менеджер', (SELECT id FROM roles WHERE code = 'manager'), 'x', 1), (3, 's@x.test', 'Сервис', (SELECT id FROM roles WHERE code = 'service'), 'x', 1)",
  ).run();
  let n = 0;
  const ctx = () => ({ db, now: T0 + n, ip: `10.0.${(n += 1)}.1`, owner: null });
  const repair = async (over: Record<string, unknown> = {}) =>
    (await submitRepair({ name: 'Иван', phone: '+7 916 123-45-67', email: 'ivan@example.com', equipmentType: 'Пила', brand: 'Champion', model: 'CP-5', description: 'Не заводится совсем', preferredContact: 'phone', consent: true, ...over }, ctx())).id!;
  const contact = async () => (await submitContact({ name: 'Ольга', email: 'olga@example.com', message: 'Есть ли доставка?', consent: true }, ctx())).id!;
  const callback = async () => (await submitCallback({ name: 'Пётр', phone: '+7 900 111-22-33', consent: true }, ctx())).id!;
  return { db, repair, contact, callback };
}

const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#336' } }).png().toBuffer();

describe('новая заявка: бренд, модель, событие и уведомление', () => {
  it('форма принимает бренд и модель; создаётся событие created и уведомление notify() нужным ролям', async () => {
    const { db, repair, contact } = setup();
    const id = await repair();
    expect(requestsRepo.findById(db, id)).toMatchObject({ repairBrand: 'Champion', repairModel: 'CP-5', status: 'new' });
    expect(requestsRepo.listEvents(db, id)[0]).toMatchObject({ kind: 'created', actorType: 'customer' });
    await contact();
    const forService = listForStaff(3, {}, { db }).map((x) => x.type);
    expect(forService.filter((t) => t === 'request.created')).toHaveLength(2); // service: repair.write + inquiries.read
    const forManager = listForStaff(2, {}, { db });
    expect(forManager.filter((x) => x.type === 'request.created')).toHaveLength(2);
    expect(listForStaff(2, {}, { db }).every((x) => !JSON.stringify(x).includes('ivan@example.com'))).toBe(true);
  });
});

describe('обращения: список, статусы, ответственный, комментарии', () => {
  it('объединённый список каналов; фильтры по каналу/статусу/поиску; ремонта в списке нет', async () => {
    const { db, repair, contact, callback } = setup();
    await repair();
    const c = await contact();
    const k = await callback();
    const all = inquiriesOps.list(manager, parseRequestFilters({}, 'inquiries'), { db });
    expect(all.total).toBe(2);
    expect(all.rows.map((r) => r.kind).sort()).toEqual(['callback', 'contact']);
    expect(inquiriesOps.list(manager, parseRequestFilters({ channel: 'callback' }, 'inquiries'), { db }).rows.map((r) => r.id)).toEqual([k]);
    expect(inquiriesOps.list(manager, parseRequestFilters({ q: 'доставка' }, 'inquiries'), { db }).rows.map((r) => r.id)).toEqual([c]);
    expect(inquiriesOps.list(manager, parseRequestFilters({ q: '111-22' }, 'inquiries'), { db }).rows.map((r) => r.id)).toEqual([k]);
    expect(inquiriesOps.list(manager, parseRequestFilters({ channel: 'repair' }, 'inquiries'), { db }).total).toBe(2);
    expect(inquiriesOps.list(manager, parseRequestFilters({ status: 'closed' }, 'inquiries'), { db }).total).toBe(0);
  });

  it('статусы new → in_work → waiting → closed, события и аудит; ремонтный статус отвергается', async () => {
    const { db, contact } = setup();
    const id = await contact();
    for (const to of ['in_work', 'waiting', 'closed'] as const) inquiriesOps.setStatus(manager, id, to, 'ок', { db, now: T0 });
    expect(requestsRepo.findById(db, id)!.status).toBe('closed');
    expect(requestsRepo.listEvents(db, id).filter((e) => e.kind === 'status').map((e) => e.toStatus)).toEqual(['in_work', 'waiting', 'closed']);
    expect(() => inquiriesOps.setStatus(manager, id, 'closed', null, { db })).toThrowError(expect.objectContaining({ status: 409 }));
    expect(() => inquiriesOps.setStatus(manager, id, 'diagnostics', null, { db })).toThrowError(expect.objectContaining({ status: 400 }));
    expect(audit.list({ entity: 'inquiry' }, { db })).toHaveLength(3);
  });

  it('назначение, комментарии и массовые действия; чужие id пропускаются', async () => {
    const { db, contact, callback, repair } = setup();
    const a = await contact();
    const b = await callback();
    const r = await repair();
    inquiriesOps.assign(manager, a, 2, { db, now: T0 });
    expect(requestsRepo.findById(db, a)!.assignedStaffId).toBe(2);
    expect(() => inquiriesOps.assign(manager, a, 999, { db })).toThrowError(expect.objectContaining({ status: 400 }));
    inquiriesOps.addComment(manager, a, 'позвонил', { db, now: T0 });
    expect(inquiriesOps.get(manager, a, { db })!.comments[0]).toMatchObject({ body: 'позвонил', authorName: 'Менеджер' });
    const res = inquiriesOps.bulk(manager, [a, b, r, 99999], { type: 'status', to: 'closed' }, { db, now: T0 });
    expect(res.done.sort()).toEqual([a, b].sort());
    expect(res.skipped.sort()).toEqual([r, 99999].sort());
    expect(requestsRepo.findById(db, r)!.status).toBe('new'); // ремонт обращениями не закрывается
    expect(inquiriesOps.bulk(manager, [a], { type: 'assign', staffId: 1 }, { db }).done).toEqual([a]);
  });

  it('права: без сессии 401; без inquiries.read/write 403; ремонт по id в обращениях — 404', async () => {
    const { db, contact, repair } = setup();
    const id = await contact();
    const rid = await repair();
    expect(() => inquiriesOps.list(null, {}, { db })).toThrowError(expect.objectContaining({ status: 401 }));
    expect(() => inquiriesOps.setStatus(null, id, 'closed', null, { db })).toThrowError(expect.objectContaining({ status: 401 }));
    expect(() => inquiriesOps.list(warehouse, {}, { db })).toThrowError(expect.objectContaining({ status: 403 }));
    for (const call of [() => inquiriesOps.setStatus(warehouse, id, 'closed', null, { db }), () => inquiriesOps.assign(warehouse, id, 1, { db }), () => inquiriesOps.addComment(warehouse, id, 'x', { db }), () => inquiriesOps.bulk(warehouse, [id], { type: 'status', to: 'closed' }, { db })]) {
      expect(call).toThrowError(expect.objectContaining({ status: 403 }));
    }
    expect(inquiriesOps.get(manager, rid, { db })).toBeNull();
    expect(() => inquiriesOps.setStatus(manager, rid, 'closed', null, { db })).toThrowError(expect.objectContaining({ status: 404 }));
    expect(() => inquiriesOps.addComment(manager, 99999, 'x', { db })).toThrowError(expect.objectContaining({ status: 404 }));
  });
});

describe('заявки на ремонт', () => {
  it('таблица переходов: допустимы только перечисленные пары (все пары)', async () => {
    const { db, repair } = setup();
    for (const from of REPAIR_STATUSES) {
      for (const to of REPAIR_STATUSES) {
        const id = await repair();
        db.prepare('UPDATE requests SET status = ? WHERE id = ?').run(from, id);
        const ok = canRepairTransition(from, to);
        expect(ok).toBe(REPAIR_TRANSITIONS[from].includes(to));
        const run = () => repairsOps.setStatus(service, id, to, null, { db, now: T0 });
        if (ok) expect(run().status).toBe(to);
        else expect(run, `${from}→${to}`).toThrowError(expect.objectContaining({ status: 409 }));
      }
    }
  });

  it('смена статуса пишет письмо клиенту в очередь (есть email) и не пишет без email', async () => {
    const { db, repair } = setup();
    const withMail = await repair();
    const noMail = await repair({ email: '' });
    const count = () => (db.prepare("SELECT COUNT(*) AS c FROM mail_stub_queue WHERE event = 'request.status_changed'").get() as { c: number }).c;
    repairsOps.setStatus(service, withMail, 'diagnostics', null, { db, now: T0 });
    expect(count()).toBe(1);
    repairsOps.setStatus(service, noMail, 'diagnostics', null, { db, now: T0 });
    expect(count()).toBe(1); // без email письмо не ставится вовсе
    const { planMessages } = await import('@/integrations/mail/templates');
    expect(planMessages('request.status_changed', { number: 'REM-1', statusLabel: 'Диагностика' })).toEqual([]);
    expect(planMessages('request.status_changed', { to: 'a@b.cc', number: 'REM-1', statusLabel: 'Диагностика' })).toHaveLength(1);
  });

  it('правка бренда/модели и контактов: событие и аудит без значений ПДн; плохой телефон — 400', async () => {
    const { db, repair } = setup();
    const id = await repair();
    const r = repairsOps.updateFields(service, id, { brand: 'Stihl', model: 'MS 180', phone: '8 900 555-44-33' }, { db, now: T0 });
    expect(r).toMatchObject({ repairBrand: 'Stihl', repairModel: 'MS 180', phone: '+79005554433' });
    expect(JSON.stringify(audit.list({ entity: 'repair' }, { db }))).not.toMatch(/9005554433|ivan@example/);
    expect(() => repairsOps.updateFields(service, id, { phone: '12' }, { db })).toThrowError(expect.objectContaining({ status: 400 }));
    expect(() => repairsOps.updateFields(service, id, { email: 'нет' }, { db })).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it('фото: JPG/PNG/WebP по содержимому, не больше 5, чужое фото по id — null; не-картинка — 400', async () => {
    const { db, repair } = setup();
    const id = await repair();
    const other = await repair();
    const bytes = await png();
    for (let i = 0; i < 5; i += 1) await repairsOps.addPhoto(service, id, bytes, { db, now: T0, uploadsDir: tmp });
    await expect(repairsOps.addPhoto(service, id, bytes, { db, now: T0, uploadsDir: tmp })).rejects.toMatchObject({ status: 409 });
    await expect(repairsOps.addPhoto(service, other, new TextEncoder().encode('<?php echo 1;'), { db, uploadsDir: tmp })).rejects.toMatchObject({ status: 400 });
    await expect(repairsOps.addPhoto(service, 99999, bytes, { db, uploadsDir: tmp })).rejects.toMatchObject({ status: 404 });
    const d = repairsOps.get(service, id, { db })!;
    expect(d.photos).toHaveLength(5);
    expect(d.photos[0]!.path).toMatch(/\.webp$/);
    expect(repairsOps.photoFile(service, other, d.photos[0]!.id, { db })).toBeNull();
    expect(repairsOps.photoFile(service, id, d.photos[0]!.id, { db })).not.toBeNull();
  });

  it('права repair.write: аноним 401, менеджер без repair.write… (в сиде есть) — ок, склад 403; обращение по id ремонта — 404', async () => {
    const { db, repair, contact } = setup();
    const id = await repair();
    const cid = await contact();
    expect(() => repairsOps.list(null, {}, { db })).toThrowError(expect.objectContaining({ status: 401 }));
    for (const call of [() => repairsOps.list(warehouse, {}, { db }), () => repairsOps.setStatus(warehouse, id, 'diagnostics', null, { db }), () => repairsOps.updateFields(warehouse, id, { brand: 'x' }, { db }), () => repairsOps.assign(warehouse, id, 1, { db })]) {
      expect(call).toThrowError(expect.objectContaining({ status: 403 }));
    }
    await expect(repairsOps.addPhoto(warehouse, id, new Uint8Array(1), { db })).rejects.toMatchObject({ status: 403 });
    expect(repairsOps.get(admin, cid, { db })).toBeNull();
    expect(() => repairsOps.setStatus(admin, cid, 'diagnostics', null, { db })).toThrowError(expect.objectContaining({ status: 404 }));
    expect(repairsOps.list(manager, parseRequestFilters({ sort: 'name', dir: 'asc', pageSize: '50' }, 'repairs'), { db }).pageSize).toBe(50);
  });
});

describe('миграция 1420: старые статусы сопоставлены без потерь', () => {
  it('done/cancelled обращений → closed; ремонт in_work → diagnostics, done → completed', async () => {
    const { copyFileSync, readdirSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { openDatabase } = await import('@/server/db/connection');
    const { runMigrations } = await import('@/server/db/migrate');
    const MIG = resolve(__dirname, '../../migrations');
    const dir = mkdtempSync(join(tmpdir(), 'rts-mig1420-'));
    for (const f of readdirSync(MIG)) if (/^\d{4}_/.test(f) && Number(f.slice(0, 4)) < 1420) copyFileSync(join(MIG, f), join(dir, f));
    const db = openDatabase(':memory:');
    runMigrations(db, { dir });
    const ins = db.prepare("INSERT INTO requests (kind, status, name, created_at, updated_at) VALUES (?, ?, 'X', 1, 1)");
    ins.run('contact', 'done');
    ins.run('callback', 'cancelled');
    ins.run('question', 'in_work');
    ins.run('repair', 'in_work');
    ins.run('repair', 'done');
    ins.run('repair', 'cancelled');
    runMigrations(db, { dir: MIG });
    expect(db.prepare('SELECT kind, status FROM requests ORDER BY id').all()).toEqual([
      { kind: 'contact', status: 'closed' },
      { kind: 'callback', status: 'closed' },
      { kind: 'question', status: 'in_work' },
      { kind: 'repair', status: 'diagnostics' },
      { kind: 'repair', status: 'completed' },
      { kind: 'repair', status: 'cancelled' },
    ]);
  });
});

describe('фото с публичной формы ремонта', () => {
  it('нужна подпись из ответа формы; чужой номер/подпись → 404; не больше 5; не-картинка → 400; окно времени ограничено', async () => {
    const { submitRepairPhotos, repairPhotoToken, PHOTO_UPLOAD_WINDOW_MS } = await import('@/domain/requests/repair-photos');
    const { db, repair } = setup();
    const id = await repair();
    const number = requestsRepo.findById(db, id)!.number;
    const bytes = new Uint8Array(await png());
    const ctx = (over: Record<string, unknown> = {}) => ({ db, now: T0 + 1000, ip: '10.9.9.9', uploadsDir: tmp, ...over });
    const token = repairPhotoToken(number);

    await expect(submitRepairPhotos({ number, token: 'bad', files: [bytes] }, ctx())).rejects.toMatchObject({ status: 404 });
    await expect(submitRepairPhotos({ number: 'REM-999999', token, files: [bytes] }, ctx())).rejects.toMatchObject({ status: 404 });
    await expect(submitRepairPhotos({ number, token, files: [new TextEncoder().encode('<html>')] }, ctx())).rejects.toMatchObject({ status: 400 });
    await expect(submitRepairPhotos({ number, token, files: [] }, ctx())).rejects.toMatchObject({ status: 400 });
    await expect(submitRepairPhotos({ number, token, files: Array(6).fill(bytes) }, ctx())).rejects.toMatchObject({ status: 400 });
    await expect(submitRepairPhotos({ number, token, files: [bytes] }, ctx({ now: T0 + PHOTO_UPLOAD_WINDOW_MS + 10_000 }))).rejects.toMatchObject({ status: 404 });
    expect((await submitRepairPhotos({ number, token, files: [bytes, bytes, bytes] }, ctx())).added).toBe(3);
    await expect(submitRepairPhotos({ number, token, files: [bytes, bytes, bytes] }, ctx())).rejects.toMatchObject({ status: 409 });
    expect(requestsRepo.listPhotos(db, id)).toHaveLength(3);
    // подпись от одной заявки не подходит к другой
    const other = await repair();
    await expect(submitRepairPhotos({ number: requestsRepo.findById(db, other)!.number, token, files: [bytes] }, ctx())).rejects.toMatchObject({ status: 404 });
  });
});
