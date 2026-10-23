import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { audit } from '@/domain/admin/audit';
import { createStaff, loginStaff } from '@/domain/admin/staff';
import { ADMIN_SESSION_COOKIE } from '@/domain/admin/staff-session';
import { createImportHandlers } from '@/app/admin/(panel)/_lib/import-handlers';
import { importOps } from '@/app/admin/(panel)/_lib/import-ops';
import { importRunsRepo } from '@/server/db/repositories/import-runs';
import { productsRepo } from '@/server/db/repositories/products';
import { createTestDb } from '@/server/db/testing';
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/http/errors';
import { ymlXml } from '../importing/helpers';
import { fakeCookies } from '../auth/helpers';
import { admin, manager, T0 } from './helpers';

const XML = ymlXml({ offers: [{ id: '1' }, { id: '2' }, { id: '3', price: '' }] }); // третий — без цены
const stage = () => mkdtempSync(join(tmpdir(), 'rts-stage-'));

describe('импорт YML через сервисный слой', () => {
  it('менеджер и аноним не могут загрузить и применить; журнал менеджер видит', async () => {
    const db = createTestDb();
    const stagingDir = stage();
    expect(() => importOps.preview(manager, { fileName: 'a.yml', content: Buffer.from(XML) }, { db, stagingDir })).toThrow(ForbiddenError);
    await expect(importOps.apply(null, 1, { db, stagingDir })).rejects.toThrow();
    await expect(importOps.apply(manager, 1, { db, stagingDir })).rejects.toThrow(ForbiddenError);
    expect(importOps.history(manager, { db })).toEqual([]);
  });

  it('предпросмотр показывает числа и ошибки и НЕ пишет в каталог; в журнале режим preview', () => {
    const db = createTestDb();
    const res = importOps.preview(admin, { fileName: 'catalog.yml', content: Buffer.from(XML) }, { db, stagingDir: stage(), now: T0 });
    expect(res.summary.products).toEqual({ create: 2, update: 0, unchanged: 0 });
    expect(res.errors).toHaveLength(1);
    expect(productsRepo.count(db)).toBe(0);
    expect(importRunsRepo.get(db, res.previewId)).toMatchObject({ mode: 'preview', actorId: 1, productsCreated: 2, errorCount: 1 });
  });

  it('применение возможно только после предпросмотра: произвольный id и apply-id отвергаются', async () => {
    const db = createTestDb();
    const stagingDir = stage();
    await expect(importOps.apply(admin, 12345, { db, stagingDir })).rejects.toThrow(NotFoundError);
    const p = importOps.preview(admin, { fileName: 'c.yml', content: Buffer.from(XML) }, { db, stagingDir });
    const report = await importOps.apply(admin, p.previewId, { db, stagingDir, now: T0 });
    await expect(importOps.apply(admin, report.runId, { db, stagingDir })).rejects.toThrow(NotFoundError); // это запуск apply, не предпросмотр
  });

  it('подтверждение создаёт товары, пишет отчёт и аудит; повтор того же файла — 0 дублей', async () => {
    const db = createTestDb();
    const stagingDir = stage();
    const p1 = importOps.preview(admin, { fileName: 'c.yml', content: Buffer.from(XML) }, { db, stagingDir, now: T0 });
    const r1 = await importOps.apply(admin, p1.previewId, { db, stagingDir, now: T0 });
    expect(r1.products).toMatchObject({ created: 2, updated: 0 });
    expect(productsRepo.count(db)).toBe(2);
    expect(readdirSync(stagingDir)).toEqual([]); // служебный файл убран
    const a = audit.list({ entity: 'import' }, { db });
    expect(a[0]).toMatchObject({ action: 'import.apply', actorId: '1', actorType: 'staff' });

    const p2 = importOps.preview(admin, { fileName: 'c.yml', content: Buffer.from(XML) }, { db, stagingDir, now: T0 });
    expect(p2.summary.products).toEqual({ create: 0, update: 0, unchanged: 2 });
    const r2 = await importOps.apply(admin, p2.previewId, { db, stagingDir, now: T0 });
    expect(r2.products).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect(productsRepo.count(db)).toBe(2);
    expect(importOps.history(admin, { db }).map((r) => r.mode)).toEqual(['apply', 'preview', 'apply', 'preview']);
  });

  it('вредные и неподходящие файлы отклоняются до разбора: расширение, не XML, сущности, размер, нет YML', () => {
    const db = createTestDb();
    const stagingDir = stage();
    const run = (name: string, content: Buffer) => () => importOps.preview(admin, { fileName: name, content }, { db, stagingDir });
    expect(run('virus.exe', Buffer.from(XML))).toThrow(ValidationError);
    expect(run('a.yml', Buffer.from('просто текст'))).toThrow(/XML/);
    expect(run('a.yml', Buffer.from('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><yml_catalog>&e;</yml_catalog>'))).toThrow(ValidationError);
    expect(run('a.xml', Buffer.from('<html><body/></html>'))).toThrow(/YML/);
    expect(run('big.yml', Buffer.alloc(20 * 1024 * 1024 + 1, 0x20))).toThrow(/20 МБ/);
    expect(run('empty.yml', Buffer.alloc(0))).toThrow(ValidationError);
    expect(importRunsRepo.list(db)).toEqual([]);
    expect(readdirSync(stagingDir)).toEqual([]);
  });
});

describe('импорт: HTTP-обработчики', () => {
  async function setup() {
    const db = createTestDb();
    const stagingDir = stage();
    await createStaff({ email: 'boss@shop.test', password: 'admin-password-1', role: 'admin' }, { db, now: T0 });
    await createStaff({ email: 'mgr@shop.test', password: 'manager-password-1', role: 'manager' }, { db, now: T0 });
    const tokenFor = async (email: string, password: string) => {
      const c = fakeCookies();
      await loginStaff({ email, password }, { db, cookies: c, ip: '1.1.1.1', now: T0 });
      return c.jar.get(ADMIN_SESSION_COOKIE)!;
    };
    const h = createImportHandlers({ db, now: T0, stagingDir });
    const post = (handler: (r: Request) => Promise<Response>, path: string, body: FormData, o: { token?: string; origin?: string } = {}) =>
      handler(
        new Request(`http://shop.test/admin/import/${path}`, {
          method: 'POST',
          headers: { host: 'shop.test', origin: o.origin ?? 'http://shop.test', ...(o.token ? { cookie: `${ADMIN_SESSION_COOKIE}=${o.token}` } : {}) },
          body,
        }),
      );
    const fileForm = (name: string, content: string) => {
      const f = new FormData();
      f.set('file', new File([content], name, { type: 'text/xml' }));
      return f;
    };
    return { db, h, tokenFor, post, fileForm };
  }

  it('загрузка: аноним 401, менеджер 403, чужой Origin 403; админ получает редирект на предпросмотр', async () => {
    const { db, h, tokenFor, post, fileForm } = await setup();
    expect((await post(h.upload, 'upload', fileForm('a.yml', XML))).status).toBe(401);
    expect((await post(h.upload, 'upload', fileForm('a.yml', XML), { token: await tokenFor('mgr@shop.test', 'manager-password-1') })).status).toBe(403);
    const adminToken = await tokenFor('boss@shop.test', 'admin-password-1');
    expect((await post(h.upload, 'upload', fileForm('a.yml', XML), { token: adminToken, origin: 'http://evil.test' })).status).toBe(403);
    expect(importRunsRepo.list(db)).toEqual([]);

    const ok = await post(h.upload, 'upload', fileForm('a.yml', XML), { token: adminToken });
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toMatch(/^\/admin\/import\?preview=\d+$/);
  });

  it('загрузка без файла и с плохим файлом → редирект с понятной ошибкой, ничего не записано', async () => {
    const { db, h, tokenFor, post, fileForm } = await setup();
    const token = await tokenFor('boss@shop.test', 'admin-password-1');
    const none = await post(h.upload, 'upload', new FormData(), { token });
    expect(none.status).toBe(303);
    expect(decodeURIComponent(none.headers.get('location')!)).toContain('error=Выберите файл');
    const bad = await post(h.upload, 'upload', fileForm('a.yml', 'это не xml'), { token });
    expect(decodeURIComponent(bad.headers.get('location')!)).toMatch(/error=.*XML/);
    expect(importRunsRepo.list(db)).toEqual([]);
  });

  it('подтверждение: менеджер 403; админ применяет и попадает на отчёт', async () => {
    const { db, h, tokenFor, post, fileForm } = await setup();
    const adminToken = await tokenFor('boss@shop.test', 'admin-password-1');
    const up = await post(h.upload, 'upload', fileForm('a.yml', XML), { token: adminToken });
    const id = /preview=(\d+)/.exec(up.headers.get('location')!)![1]!;
    const form = () => {
      const f = new FormData();
      f.set('previewId', id);
      return f;
    };
    expect((await post(h.apply, 'apply', form(), { token: await tokenFor('mgr@shop.test', 'manager-password-1') })).status).toBe(403);
    expect(productsRepo.count(db)).toBe(0);
    const done = await post(h.apply, 'apply', form(), { token: adminToken });
    expect(done.status).toBe(303);
    expect(done.headers.get('location')).toMatch(/^\/admin\/import\?report=\d+$/);
    expect(productsRepo.count(db)).toBe(2);
  });
});
