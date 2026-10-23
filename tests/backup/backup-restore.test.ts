import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBackup, listArchive, writeTarGz } from '../../scripts/backup';
import { restoreBackup } from '../../scripts/restore';
import { openDatabase } from '@/server/db/connection';
import { runMigrations } from '@/server/db/migrate';
import { addProduct } from '../ordering/helpers';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'rts-backup-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** Рабочая папка данных: БД с товаром (WAL, не сброшенный в основной файл), uploads, outbox 1С и «секреты» рядом. */
function makeData() {
  const dataDir = tmp();
  const databasePath = join(dataDir, 'rts.sqlite');
  const db = openDatabase(databasePath);
  runMigrations(db);
  const productId = addProduct(db, { name: 'Бензопила для проверки', sku: 'BK-1', price: 1_234_500 });
  mkdirSync(join(dataDir, 'uploads', 'ab', 'cd'), { recursive: true });
  const photo = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7) % 256));
  writeFileSync(join(dataDir, 'uploads', 'ab', 'cd', 'photo.webp'), photo);
  writeFileSync(join(dataDir, 'uploads', 'logo.png'), 'PNG-ish');
  mkdirSync(join(dataDir, 'onec-outbox'));
  writeFileSync(join(dataDir, 'onec-outbox', 'RTS-000001.json'), '{"number":"RTS-000001"}');
  // то, чего в архиве быть не должно
  writeFileSync(join(dataDir, '.env'), 'SESSION_SECRET=do-not-archive');
  writeFileSync(join(dataDir, 'notes-secret.txt'), 'private');
  return { dataDir, databasePath, db, productId, photo };
}

const productName = (db: ReturnType<typeof openDatabase>, id: number) =>
  (db.prepare('SELECT name FROM products WHERE id = ?').get(id) as { name: string } | undefined)?.name;

describe('резервная копия', () => {
  it('содержит БД (в том числе данные из WAL), uploads и outbox; секретов и .env нет', async () => {
    const { dataDir, databasePath, db, photo } = makeData();
    const res = await createBackup({ databasePath, dataDir, outDir: join(dataDir, 'backups'), now: Date.UTC(2026, 9, 22, 12, 0, 0) });
    expect(res.file).toMatch(/rts-backup-20261022-120000\.tar\.gz$/);
    const names = (await listArchive(res.file)).map((e) => e.name).sort();
    expect(names).toEqual(['manifest.json', 'onec-outbox/RTS-000001.json', 'rts.sqlite', 'uploads/ab/cd/photo.webp', 'uploads/logo.png']);
    expect(names.join()).not.toMatch(/env|secret/i);
    // источник не изменён и остаётся рабочим
    expect(readFileSync(join(dataDir, 'uploads', 'ab', 'cd', 'photo.webp')).equals(photo)).toBe(true);
    db.close();
  });

  it('backup → потеря данных → restore: товар, файлы и их содержимое совпадают; прежнее состояние сохранено рядом', async () => {
    const { dataDir, databasePath, db, productId, photo } = makeData();
    const res = await createBackup({ databasePath, dataDir, outDir: join(dataDir, 'backups'), now: Date.UTC(2026, 9, 22, 12) });
    // авария: товар удалён, фото потеряно, появилось лишнее
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    db.close();
    rmSync(join(dataDir, 'uploads', 'ab'), { recursive: true });
    writeFileSync(join(dataDir, 'uploads', 'stray.txt'), 'после копии');

    const r = await restoreBackup({ file: res.file, databasePath, dataDir, force: true, now: Date.UTC(2026, 9, 22, 13) });
    expect(r.files).toBe(4);

    const restored = openDatabase(databasePath);
    expect(productName(restored, productId)).toBe('Бензопила для проверки');
    expect((restored.prepare('SELECT price_kopecks AS p FROM products WHERE id = ?').get(productId) as { p: number }).p).toBe(1_234_500);
    expect((restored.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok');
    restored.close();
    expect(sha(readFileSync(join(dataDir, 'uploads', 'ab', 'cd', 'photo.webp')))).toBe(sha(photo));
    expect(readFileSync(join(dataDir, 'uploads', 'logo.png'), 'utf8')).toBe('PNG-ish');
    expect(readFileSync(join(dataDir, 'onec-outbox', 'RTS-000001.json'), 'utf8')).toBe('{"number":"RTS-000001"}');
    expect(existsSync(join(dataDir, 'uploads', 'stray.txt'))).toBe(false);
    // прежнее состояние не уничтожено
    const pre = readdirSync(dataDir).filter((n) => n.startsWith('pre-restore-'));
    expect(pre).toHaveLength(1);
    expect(readFileSync(join(dataDir, pre[0] as string, 'uploads', 'stray.txt'), 'utf8')).toBe('после копии');
    // .env и прочее не тронуты
    expect(readFileSync(join(dataDir, '.env'), 'utf8')).toBe('SESSION_SECRET=do-not-archive');
  });

  it('без --force поверх существующих данных не восстанавливает и ничего не меняет', async () => {
    const { dataDir, databasePath, db, productId } = makeData();
    const res = await createBackup({ databasePath, dataDir, outDir: join(dataDir, 'backups') });
    await expect(restoreBackup({ file: res.file, databasePath, dataDir })).rejects.toThrow(/--force/);
    expect(productName(db, productId)).toBe('Бензопила для проверки');
    expect(readdirSync(dataDir).some((n) => n.startsWith('pre-restore-'))).toBe(false);
    db.close();
  });

  it('в пустую папку (новый сервер) восстанавливает без --force', async () => {
    const src = makeData();
    const res = await createBackup({ databasePath: src.databasePath, dataDir: src.dataDir, outDir: join(src.dataDir, 'backups') });
    src.db.close();
    const dst = tmp();
    await restoreBackup({ file: res.file, databasePath: join(dst, 'rts.sqlite'), dataDir: dst });
    const db = openDatabase(join(dst, 'rts.sqlite'));
    expect(productName(db, src.productId)).toBe('Бензопила для проверки');
    db.close();
    expect(readdirSync(dst).some((n) => n.startsWith('pre-restore-'))).toBe(false);
  });

  it('повреждённый архив отклоняется до замены данных', async () => {
    const { dataDir, databasePath, db, productId } = makeData();
    // содержимое не совпадает с хешем в manifest
    const bad = join(dataDir, 'bad.tar.gz');
    await writeTarGz(bad, [
      { name: 'rts.sqlite', data: Buffer.from('not a database') },
      { name: 'manifest.json', data: Buffer.from(JSON.stringify({ format: 'rts-backup', version: 1, files: { 'rts.sqlite': sha('другое') } })) },
    ]);
    await expect(restoreBackup({ file: bad, databasePath, dataDir, force: true })).rejects.toThrow();
    expect(productName(db, productId)).toBe('Бензопила для проверки');
    db.close();
  });

  it('архив с путём за пределы папки данных (../) отклоняется', async () => {
    const dataDir = tmp();
    const outside = join(dataDir, '..', 'rts-evil.txt');
    const evil = join(dataDir, 'evil.tar.gz');
    await writeTarGz(evil, [
      { name: '../rts-evil.txt', data: Buffer.from('x') },
      { name: 'manifest.json', data: Buffer.from('{}') },
    ]);
    await expect(restoreBackup({ file: evil, databasePath: join(dataDir, 'rts.sqlite'), dataDir, force: true })).rejects.toThrow(/недопустим/);
    expect(existsSync(outside)).toBe(false);
  });
});
