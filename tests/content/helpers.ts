import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll } from 'vitest';
import type { StaffSession } from '@/domain/admin/permissions';
import type { Db } from '@/server/db/connection';

export const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);
export const ADMIN: StaffSession = { staffId: 1, email: 'boss@shop.test', name: 'Админ', role: 'admin' };
export const MANAGER: StaffSession = { staffId: 2, email: 'mgr@shop.test', name: 'Менеджер', role: 'manager' };

/** Каталог для загруженных в тесте изображений (удаляется после файла). */
export function withUploadsDir(): { dir: () => string } {
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'rts-content-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return { dir: () => dir };
}

export const pngBytes = (w = 120, h = 60) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 120, b: 50 } } })
    .png()
    .toBuffer();

/** Вставка товара с нужными датами/ценами (для блоков главной). */
export function insertProduct(
  db: Db,
  p: { n: number; firstSeenAt?: string; price?: number; discount?: number | null; featured?: boolean; published?: boolean },
): number {
  const catId =
    (db.prepare("SELECT id FROM categories WHERE slug = 'sadovaya-tekhnika'").get() as { id: number } | undefined)?.id ??
    Number(db.prepare("INSERT INTO categories (external_id, name, slug) VALUES ('c-root', 'Садовая техника', 'sadovaya-tekhnika')").run().lastInsertRowid);
  const r = db
    .prepare(
      `INSERT INTO products (external_id, sku, name, slug, category_id, price_kopecks, discount_price_kopecks, in_stock, published, featured, first_seen_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .run(
      `ext-${p.n}`,
      `SKU-${p.n}`,
      `Товар ${p.n}`,
      `tovar-${p.n}`,
      catId,
      p.price ?? 100_000,
      p.discount ?? null,
      p.published === false ? 0 : 1,
      p.featured ? 1 : 0,
      p.firstSeenAt ?? '2020-01-01T00:00:00.000Z',
      '2020-01-01T00:00:00.000Z',
    );
  return Number(r.lastInsertRowid);
}
