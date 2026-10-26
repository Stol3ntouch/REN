import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImportFileError } from '@/importing/yml';
import { readCsvTable } from '@/importing/table';
import { productsAdminRepo } from '@/server/db/repositories/products-admin';
import { addCategory, createTestDb } from '../catalog/helpers';
import { planCsv, runCsv } from './csv-run';

const fx = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), 'tests/fixtures', 'import-' + name)));
function world() {
  const db = createTestDb();
  addCategory(db, 'Инструмент', 'instrument');
  return db;
}
const byName = (db: ReturnType<typeof createTestDb>, sku: string) => (db.prepare('SELECT id FROM products WHERE sku = ?').get(sku) as { id: number } | undefined)?.id;

describe('CSV на фикстурах', () => {
  it('корректный: создаёт товары, категории и бренд из файла', async () => {
    const db = world();
    const { outcome } = await runCsv(db, fx('products-ok.csv'), { unknownRefs: 'create' });
    expect(outcome).toMatchObject({ created: 2, failed: 0, categoriesCreated: 2, brandsCreated: 1 });
    expect(productsAdminRepo.findById(db, byName(db, 'FX-1')!)).toMatchObject({ priceKopecks: 1299000, stockQty: 5 });
  });

  it('с BOM даёт тот же результат, что и без', () => {
    const a = planCsv(world(), fx('products-ok.csv'), { unknownRefs: 'create' });
    const b = planCsv(world(), fx('products-bom.csv'), { unknownRefs: 'create' });
    expect(b.summary).toEqual(a.summary);
    expect(readCsvTable(fx('products-bom.csv')).headers[0]).toBe('Артикул');
  });

  it('windows-1251: русские буквы читаются верно', async () => {
    const db = world();
    expect(readCsvTable(fx('products-cp1251.csv')).encoding).toBe('windows-1251');
    await runCsv(db, fx('products-cp1251.csv'), { unknownRefs: 'create' });
    expect(productsAdminRepo.findById(db, byName(db, 'FX-1')!)!.name).toBe('Бензопила Ёлка');
  });

  it('с ошибками: плохие строки получают номер, поле и причину, годные применяются', async () => {
    const db = world();
    const { plan, outcome } = await runCsv(db, fx('products-errors.csv'));
    expect(plan.rows.map((r) => r.verdict)).toEqual(['create', 'error', 'error', 'error']);
    expect(plan.issues.map((i) => [i.row, i.field])).toEqual([
      [3, 'price'],
      [4, 'sku'],
      [5, 'stock'],
    ]);
    expect(outcome).toMatchObject({ created: 1, failed: 3 });
  });

  it('повреждённый: понятная ошибка, ничего не импортируется', () => {
    expect(() => readCsvTable(fx('products-broken.csv'))).toThrow(ImportFileError);
  });

  it('с формулами: значения хранятся текстом и не исполняются', async () => {
    const db = world();
    await runCsv(db, fx('products-formulas.csv'));
    const names = (db.prepare("SELECT name FROM products WHERE sku LIKE 'FX-%' ORDER BY sku").all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(["=cmd|' /C calc'!A0", '+SUM(A1:A9)', '@HYPERLINK("http://x")']);
  });
});
