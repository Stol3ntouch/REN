import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getSetting, getShopInfo, setSetting } from '@/domain/content/settings';
import { createTestDb } from '@/server/db/testing';

const ADDRESS = 'Талдом, Садовый переулок д10';
const migration = readFileSync(join(process.cwd(), 'migrations', '0520_shop_address.sql'), 'utf8');

describe('адрес магазина — начальное значение', () => {
  it('после миграций address равен адресу владельца, координат нет', () => {
    const db = createTestDb();
    expect(getSetting('address', { db })).toBe(ADDRESS);
    const info = getShopInfo({ db });
    expect(info.address).toBe(ADDRESS);
    expect(info.latitude).toBeNull();
    expect(info.longitude).toBeNull();
  });

  it('заданное админом значение не перезаписывается, повторный запуск идемпотентен', () => {
    const db = createTestDb();
    setSetting('address', 'Другой адрес', { db, now: 5 });
    db.exec(migration);
    expect(getSetting('address', { db })).toBe('Другой адрес');
    db.exec(migration);
    expect(getSetting('address', { db })).toBe('Другой адрес');
  });
});
