import { describe, expect, it } from 'vitest';
import { BATCH_SIZE } from '@/importing/limits';
import { parseOptions } from '@/importing/options';
import { applyRows } from '@/importing/products/apply';
import { planRows } from '@/importing/products/plan';
import { autoMap } from '@/importing/fields';
import { parseRows } from '@/importing/rows';
import { readCsvTable } from '@/importing/table';
import { ImportFileError } from '@/importing/yml';
import { attributesRepo } from '@/server/db/repositories/attributes';
import { brandsRepo } from '@/server/db/repositories/brands';
import { categoriesRepo } from '@/server/db/repositories/categories';
import { imagesRepo } from '@/server/db/repositories/images';
import { productsAdminRepo } from '@/server/db/repositories/products-admin';
import { productsRepo } from '@/server/db/repositories/products';
import { stockRepo } from '@/server/db/repositories/stock';
import { addCategory, addProduct, createTestDb } from '../catalog/helpers';
import { csv, encodeCp1251, utf8, utf8Bom } from './csv-helpers';
import { planCsv, runCsv, T0 } from './csv-run';

const HEAD = ['Артикул', 'Название', 'Цена', 'Категория'];

function world() {
  const db = createTestDb();
  const tools = addCategory(db, 'Инструмент', 'instrument');
  const saws = addCategory(db, 'Бензопилы', 'benzopily', tools);
  const existing = addProduct(db, { name: 'Старая пила', sku: 'EX-1', categoryId: saws, priceRub: 1000 });
  return { db, tools, saws, existing };
}

const bySku = (db: ReturnType<typeof createTestDb>, sku: string) => (db.prepare('SELECT id FROM products WHERE sku = ?').all(sku) as { id: number }[]).map((r) => productsAdminRepo.findById(db, r.id)!);

describe('CSV: создание товаров', () => {
  it('создаёт товар со всеми полями: категория по пути, бренд, фото, характеристика, остаток', async () => {
    const { db, saws } = world();
    attributesRepo.insert(db, { code: 'power', name: 'Мощность', type: 'number', unit: 'Вт', required: false, filterable: true, comparable: true, sort: 0 });
    const text = csv([
      ['Артикул', 'Название', 'Цена', 'Старая цена', 'Остаток', 'Категория', 'Бренд', 'Штрихкод', 'Описание', 'Публикация', 'Изображения', 'attr:power', 'Внешний ID'],
      ['N-1', 'Пила новая', '1 250,50', '1500', '7', 'Инструмент > Бензопилы', 'Champion', '4601234567890', '<p>Хорошая</p><script>x()</script>', 'нет', 'https://champion.ru/a.jpg | https://champion.ru/b.jpg', '2000', 'ext-1'],
    ]);
    const { plan, outcome } = await runCsv(db, text, { unknownRefs: 'create' });
    expect(plan.summary).toMatchObject({ create: 1, error: 0, brandsToCreate: 1, categoriesToCreate: 0 });
    expect(outcome).toMatchObject({ created: 1, failed: 0, brandsCreated: 1 });
    const p = bySku(db, 'N-1')[0]!;
    expect(p).toMatchObject({ name: 'Пила новая', priceKopecks: 125050, oldPriceKopecks: 150000, stockQty: 7, stockTracked: true, categoryId: saws, barcode: '4601234567890', published: false, source: 'manual', externalId: 'ext-1', availability: 'in_stock' });
    expect(p.description).toContain('Хорошая');
    expect(p.description).not.toContain('script');
    expect(brandsRepo.findById(db, p.brandId!)?.name).toBe('Champion');
    expect(imagesRepo.listByProduct(db, p.id).map((i) => i.urlSource)).toEqual(['https://champion.ru/a.jpg', 'https://champion.ru/b.jpg']);
    expect(attributesRepo.valuesOfProduct(db, p.id)).toHaveLength(1);
    expect(stockRepo.listMovements(db, p.id, 5)[0]).toMatchObject({ delta: 7, qtyAfter: 7 });
    expect(p.lockedFields).toEqual([]); // импорт не закрепляет поля за «ручной правкой»
  });

  it('новому товару нужны название, цена и категория; каждая ошибка — со строкой и полем', () => {
    const { db } = world();
    const plan = planCsv(db, csv([['Артикул', 'Название', 'Цена', 'Категория'], ['A', '', '', ''], ['B', 'Нож', '10', 'Инструмент > Бензопилы']]));
    expect(plan.rows.map((r) => r.verdict)).toEqual(['error', 'create']);
    expect(plan.issues.filter((i) => i.row === 2).map((i) => i.field).sort()).toEqual(['category', 'name', 'price']);
  });

  it('формулы в ячейках хранятся текстом, а не исполняются', async () => {
    const { db } = world();
    const evil = "=HYPERLINK(\"http://evil.test\";\"x\")";
    await runCsv(db, csv([HEAD, ['F-1', evil, '10', 'Инструмент > Бензопилы'], ['F-2', '+cmd|calc', '10', 'Инструмент > Бензопилы']]));
    expect(bySku(db, 'F-1')[0]!.name).toBe(evil);
    expect(bySku(db, 'F-2')[0]!.name).toBe('+cmd|calc');
  });

  it('файл с BOM и файл в windows-1251 читаются одинаково', async () => {
    const { db } = world();
    const text = csv([HEAD, ['K-1', 'Ёлка «большая»', '99', 'Инструмент > Бензопилы']]);
    await runCsv(db, utf8Bom(text));
    await runCsv(db, encodeCp1251(csv([HEAD, ['K-2', 'Ёлка «большая»', '99', 'Инструмент > Бензопилы']])));
    expect(bySku(db, 'K-1')[0]!.name).toBe('Ёлка «большая»');
    expect(bySku(db, 'K-2')[0]!.name).toBe('Ёлка «большая»');
  });

  it('повтор того же файла — 0 дублей (идемпотентно)', async () => {
    const { db } = world();
    const text = csv([HEAD, ['I-1', 'Раз', '10', 'Инструмент > Бензопилы'], ['I-2', 'Два', '20', 'Инструмент']]);
    const first = await runCsv(db, text);
    expect(first.outcome).toMatchObject({ created: 2, updated: 0 });
    const count = productsRepo.count(db);
    const second = await runCsv(db, text);
    expect(second.outcome).toMatchObject({ created: 0, updated: 0, skipped: 2 });
    expect(productsRepo.count(db)).toBe(count);
  });
});

describe('CSV: режимы и обновление', () => {
  it('«только новые»: существующий по артикулу и по внешнему ID пропускается, не меняется', async () => {
    const { db, existing } = world();
    const ext = productsRepo.findByExternalId(db, 'yml', (db.prepare('SELECT external_id FROM products WHERE id = ?').get(existing) as { external_id: string }).external_id)!;
    const text = csv([['Артикул', 'Внешний ID', 'Название', 'Цена', 'Категория'], ['EX-1', '', 'Другое имя', '5', 'Инструмент'], ['ZZ', ext.externalId, 'Ещё имя', '5', 'Инструмент'], ['NEW', '', 'Новый', '5', 'Инструмент']]);
    const { plan } = await runCsv(db, text, { mode: 'create_only' });
    expect(plan.rows.map((r) => r.verdict)).toEqual(['skip', 'skip', 'create']);
    expect(productsAdminRepo.findById(db, existing)!.name).toBe('Старая пила');
  });

  it('«обновить»: меняет цену по артикулу; пустые ячейки не затирают значения', async () => {
    const { db, existing } = world();
    db.prepare('UPDATE products SET barcode = ?, old_price_kopecks = ? WHERE id = ?').run('1234567890', 200000, existing);
    const { plan, outcome } = await runCsv(db, csv([['Артикул', 'Цена', 'Штрихкод', 'Старая цена'], ['EX-1', '1999', '', '']]), { mode: 'update' });
    expect(plan.rows[0]).toMatchObject({ verdict: 'update', changes: ['price'] });
    expect(outcome.updated).toBe(1);
    const p = productsAdminRepo.findById(db, existing)!;
    expect(p).toMatchObject({ priceKopecks: 199900, barcode: '1234567890', oldPriceKopecks: 200000, name: 'Старая пила' });
  });

  it('«очищать пустые»: пустая ячейка стирает штрихкод и старую цену, но не обязательные поля', async () => {
    const { db, existing } = world();
    db.prepare('UPDATE products SET barcode = ?, old_price_kopecks = ? WHERE id = ?').run('1234567890', 200000, existing);
    await runCsv(db, csv([['Артикул', 'Цена', 'Штрихкод', 'Старая цена', 'Название'], ['EX-1', '', '', '', '']]), { clearEmpty: true });
    const p = productsAdminRepo.findById(db, existing)!;
    expect(p).toMatchObject({ barcode: null, oldPriceKopecks: null, priceKopecks: 100000, name: 'Старая пила' });
  });

  it('ключ external_id и barcode', async () => {
    const { db, existing } = world();
    const extId = (db.prepare('SELECT external_id FROM products WHERE id = ?').get(existing) as { external_id: string }).external_id;
    await runCsv(db, csv([['Внешний ID', 'Цена'], [extId, '555']]), { key: 'external_id' });
    expect(productsAdminRepo.findById(db, existing)!.priceKopecks).toBe(55500);
    db.prepare('UPDATE products SET barcode = ? WHERE id = ?').run('9999999999', existing);
    await runCsv(db, csv([['Штрихкод', 'Цена'], ['9999999999', '777']]), { key: 'barcode' });
    expect(productsAdminRepo.findById(db, existing)!.priceKopecks).toBe(77700);
  });

  it('createMissing=false: отсутствующие в каталоге строки пропускаются', () => {
    const { db } = world();
    const plan = planCsv(db, csv([HEAD, ['NOPE', 'Нет такого', '1', 'Инструмент']]), { createMissing: false });
    expect(plan.rows[0]).toMatchObject({ verdict: 'skip' });
  });

  it('поля, закреплённые вручную (locked_fields), не затираются без явного разрешения', async () => {
    const { db, existing } = world();
    productsAdminRepo.setLocked(db, existing, ['price']);
    const text = csv([['Артикул', 'Цена', 'Название'], ['EX-1', '1', 'Переименована']]);
    const first = await runCsv(db, text);
    expect(first.plan.rows[0]).toMatchObject({ changes: ['name'], lockedSkipped: ['price'] });
    expect(productsAdminRepo.findById(db, existing)).toMatchObject({ priceKopecks: 100000, name: 'Переименована' });
    await runCsv(db, text, { overrideLocked: true });
    expect(productsAdminRepo.findById(db, existing)!.priceKopecks).toBe(100);
  });

  it('остаток: учёт включается, движение пишется, in_stock не закрепляется, повторный импорт остатков работает', async () => {
    const { db, existing } = world();
    await runCsv(db, csv([['Артикул', 'Остаток'], ['EX-1', '5']]));
    expect(productsAdminRepo.findById(db, existing)).toMatchObject({ stockQty: 5, stockTracked: true, lockedFields: [] });
    const again = await runCsv(db, csv([['Артикул', 'Остаток'], ['EX-1', '9']]));
    expect(again.outcome.updated).toBe(1);
    expect(productsAdminRepo.findById(db, existing)!.stockQty).toBe(9);
    expect(stockRepo.listMovements(db, existing, 5)).toHaveLength(2);
  });
});

describe('CSV: проверка данных', () => {
  it('дубль артикула в файле — вторая строка с ошибкой, первая применяется', async () => {
    const { db } = world();
    const { plan, outcome } = await runCsv(db, csv([HEAD, ['D-1', 'Первый', '1', 'Инструмент'], ['D-1', 'Второй', '2', 'Инструмент']]));
    expect(plan.rows.map((r) => r.verdict)).toEqual(['create', 'error']);
    expect(plan.issues[0]).toMatchObject({ row: 3, field: 'sku' });
    expect(plan.issues[0]!.message).toMatch(/строке 2/);
    expect(outcome).toMatchObject({ created: 1, failed: 1 });
  });

  it('артикул, уже занятый другим товаром, и неоднозначный ключ — ошибки; неизвестные категория и бренд — ошибка или создание', async () => {
    const { db } = world();
    addProduct(db, { name: 'Дубль 1', sku: 'TWIN', categoryId: 1 });
    addProduct(db, { name: 'Дубль 2', sku: 'TWIN', categoryId: 1 });
    const t = csv([['Артикул', 'Название', 'Цена', 'Категория', 'Бренд'], ['TWIN', 'x', '1', 'Инструмент', ''], ['U-1', 'Неизвестные', '1', 'Нет такой > Совсем', 'НовыйБренд']]);
    const strict = planCsv(db, t);
    expect(strict.rows[0]!.issues[0]!.message).toMatch(/несколько товаров/);
    expect(strict.rows[1]!.issues.map((i) => i.field).sort()).toEqual(['brand', 'category']);
    const lax = planCsv(db, t, { unknownRefs: 'create' });
    expect(lax.rows[1]).toMatchObject({ verdict: 'create' });
    expect(lax.summary).toMatchObject({ categoriesToCreate: 2, brandsToCreate: 1 });
    await runCsv(db, t, { unknownRefs: 'create' });
    const made = categoriesRepo.listAll(db).filter((c) => c.source === 'csv');
    expect(made.map((c) => c.name)).toEqual(['Нет такой', 'Совсем']);
    expect(made[1]!.parentId).toBe(made[0]!.id);
  });

  it('внешний ID нового товара, занятый другим товаром, и строка без ключа — ошибки', () => {
    const { db, existing } = world();
    const extId = (db.prepare('SELECT external_id FROM products WHERE id = ?').get(existing) as { external_id: string }).external_id;
    const head = ['Артикул', 'Внешний ID', 'Название', 'Цена', 'Категория'];
    const plan = planCsv(db, csv([head, ['NEW-9', extId, 'x', '1', 'Инструмент']]), { key: 'sku' });
    expect(plan.rows[0]!.issues[0]).toMatchObject({ field: 'externalId' });
    const plan2 = planCsv(db, csv([head, ['', 'brand-new', 'y', '1', 'Инструмент']]), { key: 'sku' });
    expect(plan2.rows[0]!.issues[0]).toMatchObject({ field: 'sku' });
  });

  it('старая цена не больше цены — ошибка строки', () => {
    const { db } = world();
    const plan = planCsv(db, csv([['Артикул', 'Цена', 'Старая цена'], ['EX-1', '100', '90']]));
    expect(plan.rows[0]!.issues[0]).toMatchObject({ field: 'oldPrice' });
  });

  it('неверная характеристика (число вместо текста) — ошибка со строкой и полем', () => {
    const { db } = world();
    attributesRepo.insert(db, { code: 'power', name: 'Мощность', type: 'number', unit: null, required: false, filterable: true, comparable: true, sort: 0 });
    const plan = planCsv(db, csv([['Артикул', 'attr:power'], ['EX-1', 'много']]));
    expect(plan.rows[0]!.issues[0]).toMatchObject({ row: 2, field: 'attr:power' });
  });
});

describe('CSV: транзакции, пакеты, прогресс', () => {
  /** Строки, из которых одна ломается ПРИ ПРИМЕНЕНИИ (не при проверке): план подменяется. */
  function brokenPlan(db: ReturnType<typeof createTestDb>, options: ReturnType<typeof parseOptions>) {
    const text = csv([HEAD, ['B-1', 'Первый', '1', 'Инструмент'], ['B-2', 'Второй', '2', 'Инструмент'], ['B-3', 'Третий', '3', 'Инструмент']]);
    const table = readCsvTable(utf8(text));
    const plan = planRows(db, parseRows(table.headers, table.rows, autoMap(table.headers, [])), options);
    plan.rows[1]!.intent.category = 'Категории не существует'; // применение упадёт на этой строке
    return plan;
  }

  it('режим «всё или ничего»: сбой любой строки откатывает весь файл', async () => {
    const { db } = world();
    const before = productsRepo.count(db);
    const options = parseOptions({ transaction: 'atomic' });
    const out = await applyRows(db, brokenPlan(db, options), { runId: 1, actorId: 1, now: T0, options });
    expect(out.rolledBack).toBe(true);
    expect(out.created).toBe(0);
    expect(productsRepo.count(db)).toBe(before);
    expect(out.errors[0]!.message).toMatch(/Импорт отменён/);
  });

  it('пакетный режим: упавшая строка откатывается сама, остальные применяются, ошибка — в отчёте с номером строки', async () => {
    const { db } = world();
    const options = parseOptions({ transaction: 'batch' });
    const out = await applyRows(db, brokenPlan(db, options), { runId: 1, actorId: 1, now: T0, options });
    expect(out).toMatchObject({ created: 2, failed: 1, rolledBack: false });
    expect(out.errors).toEqual([expect.objectContaining({ row: 3 })]);
    expect(bySku(db, 'B-2')).toHaveLength(0);
    expect(bySku(db, 'B-1')).toHaveLength(1);
  });

  it('пакеты по 500 строк: прогресс пишется после каждого пакета, 1200 строк = 3 пакета', async () => {
    const { db } = world();
    const rows = Array.from({ length: 1200 }, (_, i) => [`BULK-${i}`, `Товар ${i}`, '10', 'Инструмент']);
    const seen: number[] = [];
    const { outcome } = await runCsv(db, csv([HEAD, ...rows]), {}, { onProgress: (n) => seen.push(n) });
    expect(BATCH_SIZE).toBe(500);
    expect(seen).toEqual([500, 1000, 1200]);
    expect(outcome.created).toBe(1200);
  });
});

describe('CSV: фото по ссылке', () => {
  const text = csv([['Артикул', 'Название', 'Цена', 'Категория', 'Изображения'], ['IMG-1', 'С фото', '1', 'Инструмент', 'https://champion.ru/x.jpg']]);

  it('без галочки фото не скачиваются (хранится только ссылка); с галочкой — только через заданный загрузчик', async () => {
    const { db } = world();
    const calls: string[] = [];
    const images = {
      fetchImage: async (url: string) => {
        calls.push(url);
        return { bytes: new Uint8Array([1]) };
      },
      storeImage: async () => ({ path: 'p/x.webp', variants: [] }) as never,
    };
    const options = parseOptions({});
    const plan = planCsv(db, text);
    await applyRows(db, plan, { runId: 1, actorId: 1, now: T0, options, images });
    expect(calls).toEqual([]);
    expect(imagesRepo.listPending(db)).toHaveLength(1);

    const on = parseOptions({ downloadImages: true });
    const out = await applyRows(db, planCsv(db, text, { mode: 'update' }), { runId: 2, actorId: 1, now: T0, options: on, images });
    // товар уже есть и без изменений -> не затронут, скачивать нечего
    expect(out.imagesStored).toBe(0);
    const db2 = world().db;
    const out2 = await applyRows(db2, planCsv(db2, text), { runId: 3, actorId: 1, now: T0, options: on, images });
    expect(calls).toEqual(['https://champion.ru/x.jpg']);
    expect(out2.imagesStored).toBe(1);
    expect(imagesRepo.listPending(db2)).toHaveLength(0);
  });

  it('сбой скачивания не откатывает товар и попадает в отчёт', async () => {
    const { db } = world();
    const on = parseOptions({ downloadImages: true });
    const out = await applyRows(db, planCsv(db, text), {
      runId: 1,
      actorId: 1,
      now: T0,
      options: on,
      images: { fetchImage: async () => Promise.reject(new Error('хост не разрешён')), storeImage: async () => ({ path: 'x', variants: [] }) as never },
    });
    expect(out).toMatchObject({ created: 1, imagesFailed: 1 });
    expect(out.errors[0]).toMatchObject({ field: 'images', row: 2 });
    expect(bySku(db, 'IMG-1')).toHaveLength(1);
  });
});

describe('файл: ограничения и повреждения', () => {
  it('повреждённый CSV (незакрытая кавычка) отвергается с понятным текстом', () => {
    expect(() => readCsvTable(utf8('Артикул;Название\nA;"не закрыта\n'))).toThrow(ImportFileError);
  });
  it('слишком большой файл отвергается до разбора', () => {
    expect(() => readCsvTable(new Uint8Array(20 * 1024 * 1024 + 1).fill(0x61))).toThrow(/20 МБ/);
  });
  it('пустой файл и файл без заголовков', () => {
    expect(() => readCsvTable(new Uint8Array())).toThrow(/пустой/);
    expect(() => readCsvTable(utf8(';;;\n1;2;3'))).toThrow(/заголовк/);
  });
});
