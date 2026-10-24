import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function files(dir: string, exts: string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}
const read = (p: string) => readFileSync(p, 'utf8');
const rel = (p: string) => relative(root, p).replace(/\\/g, '/');

describe('.env.example: только имена', () => {
  it('ни у одной переменной нет значения', () => {
    const withValue = read(join(root, '.env.example'))
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith('#'))
      .filter((l) => !/^[A-Z][A-Z0-9_]*=\s*$/.test(l));
    expect(withValue).toEqual([]);
  });

  it('все переменные, которые читает код, названы в .env.example и в docs/env.md', () => {
    const example = read(join(root, '.env.example'));
    const doc = read(join(root, 'docs', 'env.md'));
    const used = new Set<string>();
    for (const f of [...files(join(root, 'src'), ['.ts', '.tsx']), join(root, 'next.config.ts'), ...files(join(root, 'scripts'), ['.ts'])]) {
      for (const m of read(f).matchAll(/process\.env\.([A-Z][A-Z0-9_]+)|env\.([A-Z][A-Z0-9_]+)/g)) used.add((m[1] ?? m[2]) as string);
    }
    used.delete('NEXT_RUNTIME'); // служебная переменная Next.js
    used.delete('NEXT_PHASE'); // служебная переменная Next.js
    const missingExample = [...used].filter((n) => !new RegExp(`^${n}=`, 'm').test(example));
    const missingDoc = [...used].filter((n) => !doc.includes(`\`${n}\``));
    expect(missingExample, 'нет в .env.example').toEqual([]);
    expect(missingDoc, 'нет в docs/env.md').toEqual([]);
  });
});

describe('в коде и сидах нет секретов и выдуманного содержимого', () => {
  const source = [...files(join(root, 'src'), ['.ts', '.tsx', '.css']), ...files(join(root, 'scripts'), ['.ts']), ...files(join(root, 'migrations'), ['.sql'])];

  it('нет присвоенных строковых значений секретов', () => {
    const bad: string[] = [];
    for (const f of source) {
      for (const m of read(f).matchAll(/(password|secret|api[_-]?key|token)\s*[:=]\s*['"]([A-Za-z0-9+/_-]{12,})['"]/gi)) {
        // единственное исключение: заведомо непригодная для production dev-строка с пометкой в имени
        if (!/not-for-production/.test(m[2] as string)) bad.push(`${rel(f)}: ${m[1]}`);
      }
      if (/BEGIN (RSA |EC )?PRIVATE KEY|sk_live_|AKIA[0-9A-Z]{16}/.test(read(f))) bad.push(`${rel(f)}: ключ`);
    }
    expect(bad).toEqual([]);
  });

  it('миграции и сиды ничего не вставляют в отзывы, новости, акции, услуги, слайды', () => {
    const seeds = [...files(join(root, 'scripts'), ['.ts']), ...files(join(root, 'migrations'), ['.sql'])];
    for (const f of seeds) {
      // F5 (G06): единственное исключение — услуга по ремонту техники по просьбе владельца (0950_repair_service.sql)
      const targets = rel(f).endsWith('0950_repair_service.sql') ? 'reviews|company_reviews|news|promotions|slides' : 'reviews|company_reviews|news|promotions|services|slides';
      expect(read(f), rel(f)).not.toMatch(new RegExp(`INSERT\\s+(OR\\s+\\w+\\s+)?INTO\\s+(${targets})\\b`, 'i'));
    }
  });

  it('нет остатков числом и тарифов доставки в миграциях и сидах', () => {
    for (const f of [...files(join(root, 'scripts'), ['.ts']), ...files(join(root, 'migrations'), ['.sql'])]) {
      const text = read(f);
      expect(text, rel(f)).not.toMatch(/stock_qty|quantity_in_stock|остаток\s*[:=]\s*\d/i);
    }
    // способы получения заведены миграцией без цены доставки: «стоимость рассчитает менеджер»
    const delivery = read(join(root, 'migrations', '0300_ordering.sql'));
    expect(delivery).not.toMatch(/INSERT INTO delivery_methods[^;]*\b[1-9]\d{2,}\b/i);
  });

  it('пароль администратора не зашит ни в репозитории, ни в скриптах', () => {
    for (const f of [...files(join(root, 'scripts'), ['.ts']), join(root, '.env.example')]) {
      expect(read(f), rel(f)).not.toMatch(/ADMIN_PASSWORD[ \t]*=[ \t]*\S/);
    }
  });
});
