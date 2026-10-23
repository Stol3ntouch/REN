import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Найдено при проверке 360 px: select «Категория» в /admin/catalog с длинными названиями растягивал страницу до 644 px.
 * Элементы сетки не должны быть шире колонки: min-width: 0 и max-width: 100% у полей фильтров.
 */
const css = readFileSync(join(process.cwd(), 'src', 'ui', 'cart', 'admin-orders.css'), 'utf8');
const blocks = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: (m[1] as string).replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: m[2] as string }));
const bodyOf = (selector: string) => blocks.filter((b) => b.selector.split(',').map((s) => s.trim()).includes(selector)).map((b) => b.body).join('\n');

describe('поля фильтров админки не распирают страницу на 360 px', () => {
  it('.adm-field может сжиматься', () => {
    expect(bodyOf('.adm-field')).toMatch(/min-width:\s*0/);
  });
  it('select внутри поля не шире колонки', () => {
    expect(bodyOf('.adm-field select')).toMatch(/max-width:\s*100%/);
  });
});
