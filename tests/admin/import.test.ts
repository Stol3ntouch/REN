import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createImportHandlers } from '@/app/admin/(panel)/_lib/import-handlers';
import { importOps } from '@/app/admin/(panel)/_lib/import-ops';
import { audit } from '@/domain/admin/audit';
import type { StaffSession } from '@/domain/admin/permissions';
import { createStaff, loginStaff } from '@/domain/admin/staff';
import { ADMIN_SESSION_COOKIE } from '@/domain/admin/staff-session';
import { parseYml } from '@/importing/yml';
import type { Db } from '@/server/db/connection';
import { importMappingsRepo } from '@/server/db/repositories/import-mappings';
import { importRunsRepo } from '@/server/db/repositories/import-runs';
import { notificationsRepo } from '@/server/db/repositories/notifications';
import { productsAdminRepo } from '@/server/db/repositories/products-admin';
import { productsRepo } from '@/server/db/repositories/products';
import { createTestDb } from '@/server/db/testing';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { addCategory, addProduct } from '../catalog/helpers';
import { fakeCookies } from '../auth/helpers';
import { csv, encodeCp1251, utf8 } from '../importing/csv-helpers';
import { ymlXml } from '../importing/helpers';
import { admin, manager, T0 } from './helpers';

const stage = () => mkdtempSync(join(tmpdir(), 'rts-stage-'));
const FULL = join(process.cwd(), '.autopilot/2026-10-22-remtehsad-shop--wip/inputs/catalog.yml');
const HEAD = ['Артикул', 'Название', 'Цена', 'Категория', 'Остаток'];

function setup() {
  const db = createTestDb();
  const tools = addCategory(db, 'Инструмент', 'instrument');
  addCategory(db, 'Бензопилы', 'benzopily', tools);
  const o = { db, now: T0, stagingDir: stage() };
  return { db, o };
}

const upload = (o: ReturnType<typeof setup>['o'], text: string | Uint8Array, name = 'f.csv', who: StaffSession | null = admin) =>
  importOps.upload(who, { fileName: name, content: typeof text === 'string' ? utf8(text) : text }, o);

async function runWizard(o: ReturnType<typeof setup>['o'], text: string | Uint8Array, options: Record<string, unknown> = {}) {
  const up = upload(o, text);
  importOps.setOptions(admin, up.runId, options, o);
  const h = importOps.apply(admin, up.runId, { confirmOverride: true }, o);
  await h.done;
  return { runId: up.runId, run: importRunsRepo.get(o.db, up.runId)! };
}

describe('мастер: права', () => {
  it('менеджер и аноним не работают с мастером и выгрузкой; менеджер видит историю', () => {
    const { o } = setup();
    expect(() => upload(o, csv([HEAD]), 'a.csv', manager)).toThrow(ForbiddenError);
    expect(() => upload(o, csv([HEAD]), 'a.csv', null)).toThrow(UnauthorizedError);
    const up = upload(o, csv([HEAD, ['A', 'x', '1', 'Инструмент', '']]));
    expect(() => importOps.analyze(manager, up.runId, o)).toThrow(ForbiddenError);
    expect(() => importOps.apply(manager, up.runId, {}, o)).toThrow(ForbiddenError);
    expect(() => importOps.exportProducts(manager, {}, {}, o)).toThrow(ForbiddenError);
    expect(() => importOps.state(manager, up.runId, o)).toThrow(ForbiddenError);
    expect(importOps.history(manager, o).map((r) => r.id)).toEqual([up.runId]);
    expect(() => importOps.history(null, o)).toThrow(UnauthorizedError);
  });
});

describe('мастер: файл', () => {
  it('формат определяется по содержимому, а не по расширению', () => {
    const { o } = setup();
    expect(upload(o, ymlXml({ offers: [{ id: '1' }] }), 'data.txt').format).toBe('yml');
    expect(upload(o, csv([HEAD, ['A', 'x', '1', 'Инструмент', '']]), 'catalog.yml').format).toBe('csv');
  });

  it('вредное отвергается и не оставляет ни записи, ни файла: HTML, пустой, JSON, бинарный, сущности XML, больше 20 МБ', () => {
    const { db, o } = setup();
    const bad = (c: string | Uint8Array, re?: RegExp) => expect(() => upload(o, c)).toThrow(re ?? ValidationError);
    bad('<html><body>hi</body></html>', /YML/);
    bad('', /пуст/);
    bad('{"a":1}');
    bad(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]));
    bad('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><yml_catalog>&e;</yml_catalog>');
    bad(new Uint8Array(20 * 1024 * 1024 + 1).fill(0x61), /20 МБ/);
    bad('Артикул;Название\n"не закрыта;1\n', /кавычк/);
    expect(importRunsRepo.list(db)).toEqual([]);
    expect(readdirSync(o.stagingDir)).toEqual([]);
  });

  it('кодировку и разделитель можно поправить вручную', () => {
    const { o } = setup();
    // файл windows-1251 с разделителем «,»
    const up = upload(o, encodeCp1251(csv([HEAD, ['A', 'Пила', '1', 'Инструмент', '']], ',')));
    let st = importOps.state(admin, up.runId, o);
    expect(st.csv).toMatchObject({ encoding: 'windows-1251', delimiter: ',' });
    expect(st.csv!.headers).toContain('Название');
    importOps.configureFile(admin, up.runId, { encoding: 'utf-8', delimiter: ';' }, o);
    st = importOps.state(admin, up.runId, o);
    expect(st.csv!.delimiter).toBe(';');
    expect(st.csv!.headers).toHaveLength(1); // с «;» вся строка — одна колонка
    importOps.configureFile(admin, up.runId, { encoding: 'auto', delimiter: 'auto' }, o);
    expect(importOps.state(admin, up.runId, o).csv!.headers).toContain('Название');
  });
});

describe('мастер: сопоставление и пресеты', () => {
  it('автоподбор по заголовкам, ручная правка, пресет сохраняется и применяется к другому файлу', () => {
    const { o } = setup();
    const up = upload(o, csv([['Код', 'Наименование', 'Стоимость', 'Раздел'], ['A', 'x', '1', 'Инструмент']]));
    let st = importOps.state(admin, up.runId, o);
    expect(st.settings.mapping).toMatchObject({ Наименование: 'name', Стоимость: 'price' }); // «Код» и «Раздел» автоматически не подобраны? — проверяем явно ниже
    importOps.saveMapping(admin, up.runId, ['sku', 'name', 'price', 'category'], o);
    st = importOps.state(admin, up.runId, o);
    expect(st.settings.mapping).toEqual({ Код: 'sku', Наименование: 'name', Стоимость: 'price', Раздел: 'category' });
    expect(() => importOps.saveMapping(admin, up.runId, ['sku', 'sku', '', ''], o)).toThrow(ValidationError);
    const presetId = importOps.savePreset(admin, up.runId, 'Прайс поставщика', o);
    expect(importMappingsRepo.list(o.db)).toHaveLength(1);

    const second = upload(o, csv([['Раздел', 'Код', 'Прочее', 'Стоимость'], ['Инструмент', 'B', 'z', '5']]));
    importOps.applyPreset(admin, second.runId, presetId, o);
    expect(importOps.state(admin, second.runId, o).settings.mapping).toEqual({ Раздел: 'category', Код: 'sku', Прочее: '', Стоимость: 'price' });
    importOps.deletePreset(admin, presetId, o);
    expect(importMappingsRepo.list(o.db)).toEqual([]);
    expect(() => importOps.applyPreset(admin, second.runId, presetId, o)).toThrow(NotFoundError);
  });
});

describe('мастер: применение CSV', () => {
  it('файл → проверка → предпросмотр → применение: итоги, аудит, история, служебный файл убран', async () => {
    const { db, o } = setup();
    addProduct(db, { name: 'Есть', sku: 'EX', categoryId: 1, priceRub: 10 });
    const text = csv([HEAD, ['EX', 'Есть', '20', 'Инструмент', ''], ['N1', 'Новая', '5', 'Инструмент > Бензопилы', '3'], ['N2', 'Плохая', 'abc', 'Инструмент', '']]);
    const up = upload(o, text);
    const a = importOps.analyze(admin, up.runId, o);
    expect(a.summary).toMatchObject({ total: 3, create: 1, update: 1, error: 1 });
    expect(a.preview.map((r) => r.verdict)).toEqual(['update', 'create', 'error']);
    expect(a.issues[0]).toMatchObject({ row: 4, field: 'price' });
    expect(productsRepo.count(db)).toBe(1); // предпросмотр ничего не пишет

    const { run, runId: appliedId } = await runWizard(o, text);
    expect(run).toMatchObject({ mode: 'apply', status: 'done', format: 'csv', productsCreated: 1, productsUpdated: 1, errorCount: 1, progress: 3, rowsTotal: 3 });
    expect(run.errors).toEqual([expect.objectContaining({ row: 4, field: 'price' })]);
    expect(existsSync(join(o.stagingDir, `run-${appliedId}.dat`))).toBe(false);
    const actions = audit.list({ entity: 'import' }, { db }).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['import.run', 'import.apply']));

    const again = await runWizard(o, text);
    expect(again.run).toMatchObject({ productsCreated: 0, productsUpdated: 0 }); // идемпотентно
    expect(productsRepo.count(db)).toBe(2);
  });

  it('повторное открытие отчёта и выгрузка ошибок CSV', async () => {
    const { o } = setup();
    const { runId } = await runWizard(o, csv([HEAD, ['N2', 'Плохая', 'abc', 'Инструмент', '']]));
    const e = importOps.errorsCsv(manager, runId, o);
    expect(e.body.replace('﻿', '')).toBe('строка;поле;причина\r\n2;price;«abc» — не цена (пример: 1250,50)\r\n');
    expect(importOps.getRun(manager, runId, o)!.status).toBe('done');
  });

  it('«всё или ничего» с ошибками не применяется вовсе; без ошибок — применяется одной транзакцией', async () => {
    const { db, o } = setup();
    const up = upload(o, csv([HEAD, ['N1', 'Ок', '5', 'Инструмент', ''], ['N2', 'Плохая', 'abc', 'Инструмент', '']]));
    importOps.setOptions(admin, up.runId, { transaction: 'atomic' }, o);
    expect(() => importOps.apply(admin, up.runId, {}, o)).toThrow(/всё или ничего/);
    expect(productsRepo.count(db)).toBe(0);
    expect(importRunsRepo.get(db, up.runId)!.status).toBe('uploaded');
    const ok = await runWizard(o, csv([HEAD, ['N1', 'Ок', '5', 'Инструмент', '']]), { transaction: 'atomic' });
    expect(ok.run).toMatchObject({ status: 'done', productsCreated: 1 });
  });

  it('сбой при записи в atomic откатывает файл, ставит failed и шлёт уведомление; в batch ошибки строк идут в отчёт', async () => {
    const { db, o } = setup();
    db.exec("CREATE TRIGGER boom BEFORE INSERT ON products WHEN NEW.name = 'Бомба' BEGIN SELECT RAISE(ABORT, 'нельзя'); END;");
    const text = csv([HEAD, ['G1', 'Годная', '1', 'Инструмент', ''], ['G2', 'Бомба', '1', 'Инструмент', '']]);
    const atomic = await runWizard(o, text, { transaction: 'atomic' });
    expect(atomic.run.status).toBe('failed');
    expect(productsRepo.count(db)).toBe(0);
    expect(notificationsRepo).toBeDefined();
    const n = db.prepare("SELECT type, severity FROM admin_notifications WHERE type = 'import.failed'").all();
    expect(n).toHaveLength(1);

    const batch = await runWizard(o, text, { transaction: 'batch' });
    expect(batch.run).toMatchObject({ status: 'done', productsCreated: 1, errorCount: 1 });
    expect(batch.run.errors[0]).toMatchObject({ row: 3 });
  });

  it('перезапись ручных правок требует подтверждения; без него применение отклоняется', async () => {
    const { db, o } = setup();
    const id = addProduct(db, { name: 'Есть', sku: 'EX', categoryId: 1, priceRub: 10 });
    productsAdminRepo.setLocked(db, id, ['price']);
    const up = upload(o, csv([['Артикул', 'Цена'], ['EX', '99']]));
    importOps.setOptions(admin, up.runId, { overrideLocked: true }, o);
    expect(() => importOps.apply(admin, up.runId, {}, o)).toThrow(/Подтвердите/);
    await importOps.apply(admin, up.runId, { confirmOverride: true }, o).done;
    expect(productsAdminRepo.findById(db, id)!.priceKopecks).toBe(9900);
  });

  it('применённый или чужой запуск открыть повторно нельзя', async () => {
    const { o } = setup();
    const { runId } = await runWizard(o, csv([HEAD, ['N1', 'Ок', '5', 'Инструмент', '']]));
    expect(() => importOps.apply(admin, runId, {}, o)).toThrow(ConflictError);
    expect(() => importOps.apply(admin, 9999, {}, o)).toThrow(NotFoundError);
  });

  it('оборванный запуск (running слишком долго) помечается неудачным', () => {
    const { db, o } = setup();
    const id = importRunsRepo.insert(db, { fileName: 'x.csv', mode: 'apply', startedAt: new Date(T0 - 3 * 3600_000).toISOString(), finishedAt: null, categoriesCreated: 0, categoriesUpdated: 0, productsCreated: 0, productsUpdated: 0, productsUnchanged: 0, imagesStored: 0, imagesFailed: 0, errors: [], status: 'running' });
    expect(importOps.history(admin, o).find((r) => r.id === id)!.status).toBe('failed');
  });
});

describe('мастер: YML', () => {
  const XML = ymlXml({ offers: [{ id: '1' }, { id: '2' }, { id: '3', price: '' }] }); // третий — без цены

  it('тот же мастер: проверка показывает итоги и ошибки, применение создаёт товары, повтор — 0 дублей', async () => {
    const { db, o } = setup();
    const up = upload(o, XML, 'c.yml');
    expect(up.format).toBe('yml');
    const a = importOps.analyze(admin, up.runId, o);
    expect(a.summary).toMatchObject({ create: 2, update: 0 });
    expect(a.issueCount).toBe(1);
    expect(productsRepo.count(db)).toBe(0);
    const first = await runWizard(o, XML);
    expect(first.run).toMatchObject({ format: 'yml', status: 'done', productsCreated: 2, mode: 'apply' });
    expect(productsRepo.count(db)).toBe(2);
    const second = await runWizard(o, XML);
    expect(second.run).toMatchObject({ productsCreated: 0, productsUpdated: 0, productsUnchanged: 2 });
    expect(productsRepo.count(db)).toBe(2);
  });

  it('«только новые» не трогает существующие, «обновить» меняет; закреплённые поля берегутся', async () => {
    const { db, o } = setup();
    await runWizard(o, ymlXml({ offers: [{ id: '1', price: '100.00' }] }));
    const p = productsRepo.findByExternalId(db, 'yml', '1')!;
    const changed = ymlXml({ offers: [{ id: '1', price: '200.00' }] });
    await runWizard(o, changed, { mode: 'create_only' });
    expect(productsRepo.findByExternalId(db, 'yml', '1')!.priceKopecks).toBe(10000);
    productsRepo.setLockedFields(db, p.id, ['price']);
    await runWizard(o, changed, { mode: 'update' });
    expect(productsRepo.findByExternalId(db, 'yml', '1')!.priceKopecks).toBe(10000);
    await runWizard(o, changed, { mode: 'update', overrideLocked: true });
    expect(productsRepo.findByExternalId(db, 'yml', '1')!.priceKopecks).toBe(20000);
  });

  it.skipIf(!existsSync(FULL))('реальный catalog.yml (1214 товаров) проходит весь мастер: пакетами, идемпотентно', async () => {
    const { db, o } = setup();
    const bytes = new Uint8Array(readFileSync(FULL));
    const parsed = parseYml(new TextDecoder().decode(bytes));
    const first = await runWizard(o, bytes);
    expect(first.run).toMatchObject({ status: 'done', format: 'yml', productsCreated: parsed.offers.length, progress: parsed.offers.length });
    expect(parsed.offers.length).toBeGreaterThan(1200);
    expect(productsRepo.count(db)).toBe(parsed.offers.length);
    const second = await runWizard(o, bytes);
    expect(second.run).toMatchObject({ productsCreated: 0, productsUpdated: 0 });
    expect(productsRepo.count(db)).toBe(parsed.offers.length);
    expect(first.run.errorCount).toBe(parsed.errors.length);
  });
});

describe('экспорт', () => {
  const exporter: StaffSession = { staffId: 7, email: 'e@shop.test', name: 'Э', role: 'exporter', permissions: ['products.read', 'export.run'] };
  const withCost: StaffSession = { ...exporter, staffId: 8, permissions: ['products.read', 'export.run', 'products.cost'] };
  const reader: StaffSession = { ...exporter, staffId: 9, permissions: ['products.read'] };

  function filled() {
    const { db, o } = setup();
    const a = addProduct(db, { name: 'Пила', sku: 'S-1', categoryId: 2, priceRub: 100 });
    addProduct(db, { name: '=cmd', sku: 'S-2', categoryId: 1, priceRub: 50 });
    db.prepare('UPDATE products SET purchase_price_kopecks = 4000 WHERE id = ?').run(a);
    return { db, o };
  }
  const text = (g: Generator<string>) => [...g].join('');

  it('нужен export.run; закупочная цена только с products.cost; число строк в аудите и истории', () => {
    const { db, o } = filled();
    expect(() => importOps.exportProducts(reader, {}, {}, o)).toThrow(ForbiddenError);
    const plain = importOps.exportProducts(exporter, {}, {}, o);
    const body = text(plain.chunks);
    expect(plain.total).toBe(2);
    expect(body).not.toContain('Закупочная');
    expect(body).not.toContain('40,00');
    const costly = text(importOps.exportProducts(withCost, {}, {}, o).chunks);
    expect(costly).toContain('Закупочная цена');
    expect(costly).toContain('40,00');
    expect(audit.list({ entity: 'export' }, { db })[0]).toMatchObject({ action: 'export.run' });
    expect(audit.list({ entity: 'export' }, { db })[0]!.after).toMatchObject({ rows: 2 });
    expect(importRunsRepo.list(db).filter((r) => r.kind === 'export')).toHaveLength(2);
  });

  it('учитывает фильтры; формулы экранируются', () => {
    const { o } = filled();
    const one = importOps.exportProducts(exporter, { q: 'Пила' }, {}, o);
    expect(one.total).toBe(1);
    const body = text(importOps.exportProducts(exporter, {}, {}, o).chunks);
    expect(body).toContain("'=cmd");
  });

  it('выгруженный файл читается обратно без ручного сопоставления: обмен туда-обратно даёт те же данные', async () => {
    const { db, o } = filled();
    db.prepare("INSERT INTO product_images (product_id, url_source, sort) VALUES (1, 'https://champion.ru/p.jpg', 0)").run();
    const file = text(importOps.exportProducts(exporter, {}, {}, o).chunks);
    const fresh = setup();
    const up = upload(fresh.o, file);
    const st = importOps.state(admin, up.runId, fresh.o);
    expect(Object.values(st.settings.mapping).filter(Boolean).sort()).toEqual(['brand', 'barcode', 'category', 'description', 'externalId', 'images', 'name', 'oldPrice', 'price', 'published', 'sku', 'slug', 'stock'].sort());
    importOps.setOptions(admin, up.runId, { unknownRefs: 'create' }, fresh.o);
    await importOps.apply(admin, up.runId, {}, fresh.o).done;
    const rows = (d: Db) => d.prepare('SELECT sku, name, price_kopecks, slug FROM products ORDER BY sku').all();
    expect(rows(fresh.db)).toEqual(rows(db));
    expect(fresh.db.prepare("SELECT url_source FROM product_images").all()).toEqual([{ url_source: 'https://champion.ru/p.jpg' }]);
  });

  it('пресет сопоставления задаёт колонки и заголовки выгрузки', () => {
    const { db, o } = filled();
    const presetId = importMappingsRepo.save(db, 'Свой', { Код: 'sku', Цена: 'price' }, 1, '2026-10-24T00:00:00Z');
    const body = text(importOps.exportProducts(exporter, {}, { presetId }, o).chunks).replace('﻿', '');
    expect(body.split('\r\n')[0]).toBe('Код;Цена');
    expect(body.split('\r\n')[1]).toBe('S-1;100,00');
  });
});

describe('HTTP-обработчики', () => {
  async function web() {
    const { db, o } = setup();
    await createStaff({ email: 'boss@shop.test', password: 'admin-password-1', role: 'admin' }, { db, now: T0 });
    await createStaff({ email: 'mgr@shop.test', password: 'manager-password-1', role: 'manager' }, { db, now: T0 });
    const tokenFor = async (email: string, password: string) => {
      const c = fakeCookies();
      await loginStaff({ email, password }, { db, cookies: c, ip: '1.1.1.1', now: T0 });
      return c.jar.get(ADMIN_SESSION_COOKIE)!;
    };
    const h = createImportHandlers({ db, now: T0, stagingDir: o.stagingDir });
    const call = (handler: (r: Request) => Promise<Response>, path: string, init: { method: string; body?: FormData; token?: string; origin?: string }) =>
      handler(new Request(`http://shop.test/admin/api/import/${path}`, { method: init.method, headers: { host: 'shop.test', origin: init.origin ?? 'http://shop.test', ...(init.token ? { cookie: `${ADMIN_SESSION_COOKIE}=${init.token}` } : {}) }, body: init.body }));
    const form = (name: string, content: string) => {
      const f = new FormData();
      f.set('file', new File([content], name));
      return f;
    };
    return { db, h, tokenFor, call, form };
  }

  it('загрузка: аноним 401, менеджер 403, чужой Origin 403; админ — редирект в мастер; плохой файл — понятная ошибка', async () => {
    const { db, h, tokenFor, call, form } = await web();
    const csvText = csv([HEAD, ['A', 'x', '1', 'Инструмент', '']]);
    expect((await call(h.upload, 'upload', { method: 'POST', body: form('a.csv', csvText) })).status).toBe(401);
    const mgr = await tokenFor('mgr@shop.test', 'manager-password-1');
    expect((await call(h.upload, 'upload', { method: 'POST', body: form('a.csv', csvText), token: mgr })).status).toBe(403);
    const boss = await tokenFor('boss@shop.test', 'admin-password-1');
    expect((await call(h.upload, 'upload', { method: 'POST', body: form('a.csv', csvText), token: boss, origin: 'http://evil.test' })).status).toBe(403);
    expect(importRunsRepo.list(db)).toEqual([]);
    const ok = await call(h.upload, 'upload', { method: 'POST', body: form('a.csv', csvText), token: boss });
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toMatch(/^\/admin\/import\?run=\d+$/);
    const none = await call(h.upload, 'upload', { method: 'POST', body: new FormData(), token: boss });
    expect(decodeURIComponent(none.headers.get('location')!)).toContain('error=Выберите файл');
    const html = await call(h.upload, 'upload', { method: 'POST', body: form('a.csv', '<html></html>'), token: boss });
    expect(decodeURIComponent(html.headers.get('location')!)).toMatch(/error=.*YML/);
  });

  it('выгрузка: менеджер 403, админ получает CSV; ошибки запуска доступны менеджеру', async () => {
    const { db, h, tokenFor, call } = await web();
    addProduct(db, { name: 'Пила', sku: 'S-1', categoryId: 1 });
    const mgr = await tokenFor('mgr@shop.test', 'manager-password-1');
    const boss = await tokenFor('boss@shop.test', 'admin-password-1');
    expect((await call(h.export, 'export', { method: 'GET', token: mgr })).status).toBe(403);
    const res = await call(h.export, 'export', { method: 'GET', token: boss });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(await res.text()).toContain('S-1');
    const runId = importRunsRepo.list(db)[0]!.id;
    const errs = await call(h.errors, `errors?run=${runId}`, { method: 'GET', token: mgr });
    expect(errs.status).toBe(200);
  });
});
