import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { categoryHeading, splitSeoText } from '@/domain/catalog/categories';
import { CategorySeoText } from '@/ui/catalog/CategorySeoText';

describe('SEO-текст категории', () => {
  it('абзацы разделены пустой строкой; пустой и пробельный текст — без абзацев', () => {
    expect(splitSeoText('Один.\nещё строка\n\n  Два.  \n\n\n\nТри.')).toEqual(['Один.\nещё строка', 'Два.', 'Три.']);
    expect(splitSeoText(null)).toEqual([]);
    expect(splitSeoText('  \n\n ')).toEqual([]);
  });

  it('выводится абзацами <p>, HTML экранируется (тег script не попадает в разметку)', () => {
    const html = renderToStaticMarkup(<CategorySeoText name="Триммеры" text={'Первый <b>абзац</b>.\n\n<script>alert(1)</script>'} />);
    expect(html.match(/<p>/g)).toHaveLength(2);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('пустой текст — блока нет', () => {
    expect(renderToStaticMarkup(<CategorySeoText name="Триммеры" text={null} />)).toBe('');
    expect(renderToStaticMarkup(<CategorySeoText name="Триммеры" text="   " />)).toBe('');
  });

  it('H1: заданный, иначе название категории', () => {
    expect(categoryHeading({ name: 'Триммеры', h1: 'Бензотриммеры для сада' })).toBe('Бензотриммеры для сада');
    expect(categoryHeading({ name: 'Триммеры', h1: null })).toBe('Триммеры');
    expect(categoryHeading({ name: 'Триммеры', h1: '  ' })).toBe('Триммеры');
  });
});
