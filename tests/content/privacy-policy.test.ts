import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentOps } from '@/domain/content/ops';
import { getPageByKey } from '@/domain/content/queries';
import { createTestDb } from '@/server/db/testing';
import { ADMIN, T0 } from './helpers';

const migration = readFileSync(join(process.cwd(), 'migrations', '0510_privacy_policy.sql'), 'utf8');

describe('политика обработки персональных данных (/privacy)', () => {
  it('после миграций есть разделы 1–11, метки реквизитов и признак черновика', () => {
    const db = createTestDb();
    const page = getPageByKey('privacy', { db })!;
    for (let n = 1; n <= 11; n++) expect(page.body, `раздел ${n}`).toMatch(new RegExp(`^## ${n}\. `, 'm'));
    for (const label of ['НАИМЕНОВАНИЕ ОПЕРАТОРА', 'ИНН/ОГРН', 'АДРЕС', 'EMAIL ДЛЯ ЗАПРОСОВ', 'СРОК', 'ПЕРЕЧЕНЬ ПОДРЯДЧИКОВ', 'ДАТА РЕДАКЦИИ']) {
      expect(page.body, label).toContain(`[${label} — впиши]`);
    }
    expect(page.legalDraft).toBe(true);
  });

  it('не содержит выдуманных реквизитов: ИНН, ОГРН, адресов; из цифр — только телефон магазина', () => {
    const body = getPageByKey('privacy', { db: createTestDb() })!.body;
    const withoutPhone = body.replace('+7 916-655-06-06', '').replace(/\b27\.07\.2006 № 152-ФЗ/, '').replace(/^## \d+\./gm, '');
    expect(withoutPhone).not.toMatch(/\b\d{10}\b|\b\d{12}\b|\b\d{13}\b|\b\d{15}\b/);
    expect(withoutPhone).not.toMatch(/\d{6}/);
    expect(body).not.toMatch(/\b(ул\.|улица|г\.|пр-т|д\.)\s/i);
  });

  it('говорит, что аналитики и рекламных трекеров нет, и что карты не хранятся', () => {
    const body = getPageByKey('privacy', { db: createTestDb() })!.body;
    expect(body).toMatch(/аналитики и рекламных трекеров на сайте нет/);
    expect(body).toMatch(/банковских карт сайт не собирает и не хранит/);
    expect(body).toContain('OpenStreetMap');
  });

  it('повторный запуск миграции идемпотентен', () => {
    const db = createTestDb();
    const before = getPageByKey('privacy', { db })!.body;
    db.exec(migration);
    expect(getPageByKey('privacy', { db })!.body).toBe(before);
  });

  it('не затирает текст, сохранённый админом', async () => {
    const db = createTestDb();
    const page = getPageByKey('privacy', { db })!;
    // вернуть сидовое состояние, затем правка админа через штатный сервис
    db.prepare("UPDATE pages SET body = '## 4. Сроки\n[ТЕКСТ ПОЛИТИКИ — впиши]', updated_at = 0 WHERE key = 'privacy'").run();
    await contentOps.pages.save(ADMIN, page.id, { title: page.title, slug: page.slug, body: 'Текст юриста [ТЕКСТ ПОЛИТИКИ — впиши]', legalDraft: true }, { db, now: T0 });
    db.exec(migration);
    expect(getPageByKey('privacy', { db })!.body).toBe('Текст юриста [ТЕКСТ ПОЛИТИКИ — впиши]');
  });

  it('заменяет нетронутое сидовое состояние', () => {
    const db = createTestDb();
    db.prepare("UPDATE pages SET body = '## 4. Сроки\n[ТЕКСТ ПОЛИТИКИ — впиши]', updated_at = 0 WHERE key = 'privacy'").run();
    db.exec(migration);
    expect(getPageByKey('privacy', { db })!.body).toContain('## 11. Изменение политики');
  });
});
