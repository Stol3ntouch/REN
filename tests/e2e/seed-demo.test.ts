import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '@/server/db/testing';
import { runSeedDemo } from '../../scripts/seed-demo';

const count = (db: ReturnType<typeof createTestDb>, t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

describe('seed:demo', () => {
  it('без каталога: способы доставки/оплаты и страницы есть; пользователей, сотрудников, отзывов, акций нет', async () => {
    const db = createTestDb();
    const r = await runSeedDemo(db, { env: { NODE_ENV: 'development' } });
    expect(r.catalogProducts).toBe(0);
    expect(count(db, 'delivery_methods')).toBeGreaterThan(0);
    expect(count(db, 'pages')).toBeGreaterThan(0);
    for (const t of ['staff', 'users', 'reviews', 'company_reviews', 'promos', 'news', 'slides']) expect(count(db, t), t).toBe(0);
    // F5 (G06): одна услуга по ремонту техники заведена миграцией по просьбе владельца, остальных нет
    expect(count(db, 'services')).toBe(1);
  });

  it('с файлом каталога импортирует его; повтор ничего не дублирует', async () => {
    const db = createTestDb();
    const file = join(process.cwd(), 'tests', 'fixtures', 'catalog-sample.yml');
    const first = await runSeedDemo(db, { catalogFile: file, env: { NODE_ENV: 'development' } });
    expect(first.catalogProducts).toBeGreaterThan(0);
    const before = count(db, 'products');
    const second = await runSeedDemo(db, { catalogFile: file, env: { NODE_ENV: 'development' } });
    expect(count(db, 'products')).toBe(before);
    expect(second.catalogProducts).toBe(before);
  });

  it('в production отказывается работать', async () => {
    await expect(runSeedDemo(createTestDb(), { env: { NODE_ENV: 'production' } })).rejects.toThrow(/production/);
  });
});
