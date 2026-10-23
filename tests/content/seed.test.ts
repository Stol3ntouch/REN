import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '@/server/db/testing';

const root = process.cwd();
const sqlFiles = () => readdirSync(join(root, 'migrations')).filter((f) => /^05\d\d_.*\.sql$/.test(f));
const seedFiles = () => readdirSync(join(root, 'scripts', 'seed')).filter((f) => f.endsWith('.ts'));

describe('нет выдуманного содержимого (R48)', () => {
  it('после миграций нет ни одного слайда, новости, акции, услуги и отзыва о компании', () => {
    const db = createTestDb();
    for (const t of ['slides', 'news', 'promotions', 'services', 'company_reviews']) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, t).toBe(0);
    }
  });

  it('grep: миграции и сид не вставляют отзывы, рейтинги и разделы-витрины', () => {
    const texts = [
      ...sqlFiles().map((f) => [f, readFileSync(join(root, 'migrations', f), 'utf8')] as const),
      ...seedFiles().map((f) => [f, readFileSync(join(root, 'scripts', 'seed', f), 'utf8')] as const),
    ];
    for (const [file, text] of texts) {
      expect(text, file).not.toMatch(/INSERT\s+INTO\s+(company_reviews|news|promotions|services|slides)\b/i);
      expect(text, file).not.toMatch(/INSERT\s+INTO\s+\w*reviews?\b/i);
      expect(text, file).not.toMatch(/★|⭐|4[.,][0-9]\s*из\s*5/);
    }
  });

  it('системные страницы — только метки-заглушки, правовые помечены черновиком', () => {
    const db = createTestDb();
    const rows = db.prepare('SELECT key, body, legal_draft FROM pages').all() as { key: string; body: string; legal_draft: number }[];
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    for (const k of ['about', 'delivery', 'warranty', 'faq', 'terms', 'privacy']) expect(byKey[k], k).toBeDefined();
    expect(byKey.about!.legal_draft).toBe(0);
    for (const k of ['delivery', 'warranty', 'faq', 'terms', 'privacy']) expect(byKey[k]!.legal_draft, k).toBe(1);
    // тексты о компании не выдуманы: только метка
    expect(byKey.about!.body).toMatch(/\[[^\]]+— впиши\]/);
    expect(byKey.about!.body.replace(/\[[^\]]+— впиши\]/g, '').trim()).toBe('');
  });
});
