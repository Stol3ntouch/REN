import { describe, expect, it } from 'vitest';
import { openDatabase } from '@/server/db/connection';
import { getMigrationVersion } from '@/server/db/migrate';
import { createTestDb } from '@/server/db/testing';
import { createHealthHandler } from '@/server/http/health';

describe('GET /api/health', () => {
  it('200 и версия миграций, когда БД доступна', async () => {
    const db = createTestDb();
    const res = await createHealthHandler(() => db)();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.migrationVersion).toBe(getMigrationVersion(db));
    expect(body.migrationVersion).toBeGreaterThanOrEqual(1);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('503 без стек-трейса и текста исключения, когда БД недоступна', async () => {
    const handler = createHealthHandler(() => {
      throw new Error('SQLITE_CANTOPEN: C:\\secret\\dir\\rts.sqlite');
    });
    const res = await handler();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text).status).toBe('error');
    expect(text).not.toContain('SQLITE_CANTOPEN');
    expect(text).not.toContain('secret');
    expect(text).not.toMatch(/\bat \w+/);
  });

  it('503, если миграции не применены', async () => {
    const res = await createHealthHandler(() => openDatabase(':memory:'))();
    expect(res.status).toBe(503);
  });
});
