import { describe, expect, it } from 'vitest';
import { applyImport, parseYml, planImport } from '@/importing/yml';
import type { Db } from '@/server/db/connection';
import { brandsRepo } from '@/server/db/repositories/brands';
import { productsRepo } from '@/server/db/repositories/products';
import { createTestDb } from '@/server/db/testing';
import { offerXml, ymlXml } from '../importing/helpers';

const NOW = new Date('2026-10-24T10:00:00.000Z');

const withVendor = (id: string, vendor: string | null) => offerXml({ id }).replace('</offer>', vendor === null ? '</offer>' : `<vendor>${vendor}</vendor></offer>`);

async function run(db: Db, offers: string[]) {
  const plan = planImport(parseYml(ymlXml({ offers })), db, { fileName: 't.yml', now: NOW });
  await applyImport(plan, db, { now: NOW });
}

const brandOf = (db: Db, externalId: string) => (db.prepare('SELECT brand_id FROM products WHERE external_id = ?').get(externalId) as { brand_id: number | null }).brand_id;
const brandCount = (db: Db) => (db.prepare('SELECT COUNT(*) AS n FROM brands').get() as { n: number }).n;

describe('импорт YML: бренд определяется только по данным файла', () => {
  it('<vendor> создаёт бренд (source=yml) и привязывает к нему товар', async () => {
    const db = createTestDb();
    await run(db, [withVendor('1', 'Champion'), withVendor('2', 'Champion')]);
    expect(brandCount(db)).toBe(1);
    const b = brandsRepo.findByName(db, 'Champion')!;
    expect(b.source).toBe('yml');
    expect(b.slug).toBe('champion');
    expect(brandOf(db, '1')).toBe(b.id);
    expect(brandOf(db, '2')).toBe(b.id);
  });

  it('без <vendor> бренд не выдумывается: brand_id пуст, брендов нет', async () => {
    const db = createTestDb();
    await run(db, [withVendor('1', null)]);
    expect(brandCount(db)).toBe(0);
    expect(brandOf(db, '1')).toBeNull();
  });

  it('повторный импорт идемпотентен, регистр названия не плодит бренды', async () => {
    const db = createTestDb();
    await run(db, [withVendor('1', 'Champion')]);
    await run(db, [withVendor('1', 'CHAMPION'), withVendor('3', 'champion')]);
    expect(brandCount(db)).toBe(1);
    expect(brandOf(db, '3')).toBe(brandsRepo.findByName(db, 'Champion')!.id);
  });

  it('бренд, назначенный администратором вручную, импорт не перезаписывает', async () => {
    const db = createTestDb();
    await run(db, [withVendor('1', null)]);
    const manual = brandsRepo.insert(db, { name: 'Вручную', slug: 'vruchnuyu', description: null, siteUrl: null, published: true, sort: 0, seoTitle: null, seoDescription: null }, NOW.toISOString());
    brandsRepo.setProductBrand(db, productsRepo.findByExternalId(db, 'yml', '1')!.id, manual);
    await run(db, [withVendor('1', 'Champion')]);
    expect(brandOf(db, '1')).toBe(manual);
  });

  it('бренд из прежнего импорта заменяется, если в файле другой производитель', async () => {
    const db = createTestDb();
    await run(db, [withVendor('1', 'Champion')]);
    await run(db, [withVendor('1', 'Huter')]);
    expect(brandOf(db, '1')).toBe(brandsRepo.findByName(db, 'Huter')!.id);
  });
});
