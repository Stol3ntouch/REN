import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { basisPointsField, bpInput, kopecksField, listField, rubInput } from '@/app/admin/(panel)/settings/_forms';
import { ValidationError } from '@/server/http/errors';

const PANEL = join(process.cwd(), 'src', 'app', 'admin', '(panel)');
const read = (rel: string) => readFileSync(join(PANEL, rel), 'utf8');

describe('страницы C12 закрыты нужным правом (и домен проверяет его ещё раз — см. тесты сервисов → 403)', () => {
  const pages: [string, string][] = [
    ['settings/shipping/page.tsx', 'shipping.write'],
    ['settings/payments/page.tsx', 'payments.write'],
    ['settings/warehouses/page.tsx', 'warehouses.write'],
    ['settings/taxes/page.tsx', 'settings.write'],
    ['settings/email/page.tsx', 'email.write'],
    ['settings/backup/page.tsx', 'backup.run'],
    ['integrations/page.tsx', 'integrations.read'],
  ];
  it.each(pages)('%s → %s', (rel, perm) => {
    expect(read(rel)).toContain(`requireStaffPage('${perm}')`);
  });

  it('маршрут скачивания копии — только с backup.run', () => {
    expect(readFileSync(join(PANEL, '..', 'api', 'backup', 'download', 'route.ts'), 'utf8')).toContain("withStaffPermission('backup.run'");
  });

  it('server actions идут через runAction (Origin, сессия, аудит отказов) и не принимают секретов', () => {
    for (const rel of ['settings/shipping/actions.ts', 'settings/payments/actions.ts', 'settings/warehouses/actions.ts', 'settings/taxes/actions.ts', 'settings/email/actions.ts', 'settings/backup/actions.ts', 'warehouse/actions.ts']) {
      expect(read(rel), rel).toMatch(/runAction|runStateAction/);
    }
    const payments = read('settings/payments/actions.ts');
    expect(payments).not.toMatch(/apiKey|api_key|secret|PAYMENT_API_KEY/i);
  });

  it('форма оплаты не содержит полей для ключей и секретов', () => {
    const page = read('settings/payments/page.tsx');
    expect(page).not.toMatch(/name="(apiKey|api_key|secret|token|password)"/i);
    expect(page).not.toMatch(/type="password"/);
  });
});

describe('разбор полей форм: рубли → копейки без float, проценты → сотые доли', () => {
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };
  it('kopecksField', () => {
    expect(kopecksField(form({ a: '1 250,50' }), 'a', 'x')).toBe(125_050);
    expect(kopecksField(form({ a: '0' }), 'a', 'x')).toBe(0);
    expect(kopecksField(form({ a: '' }), 'a', 'x', { nullable: true })).toBeNull();
    expect(() => kopecksField(form({ a: '12,345' }), 'a', 'x')).toThrow(ValidationError);
    expect(() => kopecksField(form({ a: '-5' }), 'a', 'x')).toThrow(ValidationError);
    expect(() => kopecksField(form({ a: 'abc' }), 'a', 'x')).toThrow(ValidationError);
  });
  it('basisPointsField и обратное преобразование', () => {
    expect(basisPointsField(form({ p: '1,5' }), 'p', 'x')).toBe(150);
    expect(basisPointsField(form({ p: '20' }), 'p', 'x')).toBe(2000);
    expect(basisPointsField(form({ p: '0,05' }), 'p', 'x')).toBe(5);
    expect(basisPointsField(form({ p: '' }), 'p', 'x')).toBe(0);
    expect(() => basisPointsField(form({ p: '1,555' }), 'p', 'x')).toThrow(ValidationError);
    expect(() => basisPointsField(form({ p: '-1' }), 'p', 'x')).toThrow(ValidationError);
    expect(bpInput(150)).toBe('1,5');
    expect(bpInput(2000)).toBe('20');
    expect(bpInput(5)).toBe('0,05');
    expect(rubInput(125_050)).toBe('1250,50');
    expect(rubInput(100)).toBe('1');
    expect(rubInput(null)).toBe('');
  });
  it('listField разбивает по строкам, запятым и «;»', () => {
    expect(listField(form({ r: 'Москва\nТула, Рязань;  ' }), 'r')).toEqual(['Москва', 'Тула', 'Рязань']);
  });
});
