import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseBody, safeHref, safeImageSrc } from '@/domain/content/markup';
import { RichText } from '@/ui/home/RichText';

const html = (text: string) => renderToStaticMarkup(<RichText text={text} />);

describe('содержимое страниц: безопасный формат без сырого HTML (XSS)', () => {
  it('теги и обработчики событий остаются текстом: <script>, onerror, iframe', () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<iframe src="https://evil.test"></iframe>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<iframe');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('javascript:, data: и vbscript: в ссылках не становятся ссылками', () => {
    const out = html('[клик](javascript:alert(1)) и [ещё](data:text/html;base64,AAAA) и [тоже](JaVaScRiPt:alert(2)) и [протокол](//evil.test/x)');
    expect(out).not.toMatch(/href="(javascript|data|vbscript|\/\/)/i);
    expect(out).not.toContain('javascript:');
    expect(out).toContain('клик');
  });

  it('картинка принимается только из хранилища загрузок; внешняя и javascript: отбрасываются', () => {
    expect(html('![лого](https://evil.test/x.png)')).not.toContain('<img');
    expect(html('![x](javascript:alert(1))')).not.toContain('<img');
    expect(html('![x](/api/catalog/media/../../etc/passwd)')).not.toContain('<img');
    const ok = html('![Газонокосилка](/api/catalog/media/ab12cd34-1.webp)');
    expect(ok).toContain('<img src="/api/catalog/media/ab12cd34-1.webp" alt="Газонокосилка"');
  });

  it('кавычки и угловые скобки в тексте ссылки и подписи экранируются', () => {
    const out = html('[<b>"x"</b>](https://shop.test/a?b=1&c=2)');
    expect(out).not.toContain('<b>');
    expect(out).toContain('&lt;b&gt;');
    expect(out).toContain('href="https://shop.test/a?b=1&amp;c=2"');
  });

  it('допустимая разметка работает: заголовки, списки, цитата, жирный, курсив, внешняя ссылка с rel', () => {
    const out = html('## Раздел\n\nТекст **важно** и *мягко*, [сайт](https://example.test)\n\n- один\n- два\n\n1. первый\n2. второй\n\n> цитата\n\n---');
    expect(out).toContain('<h2>Раздел</h2>');
    expect(out).toContain('<strong>важно</strong>');
    expect(out).toContain('<em>мягко</em>');
    expect(out).toMatch(/<a href="https:\/\/example.test" rel="noopener noreferrer nofollow"/);
    expect(out).toContain('<ul><li>один</li><li>два</li></ul>');
    expect(out).toContain('<ol><li>первый</li><li>второй</li></ol>');
    expect(out).toContain('<blockquote>цитата</blockquote>');
    expect(out).toContain('<hr/>');
  });

  it('метки-заглушки «[… — впиши]» по-прежнему выделяются', () => {
    expect(html('Адрес: [АДРЕС — впиши]')).toMatch(/class="placeholder"[^>]*>\[АДРЕС — впиши\]/);
  });

  it('safeHref / safeImageSrc: чистые проверки', () => {
    expect(safeHref('https://a.test/x')).toBe('https://a.test/x');
    expect(safeHref('/catalog')).toBe('/catalog');
    expect(safeHref('mailto:a@b.test')).toBe('mailto:a@b.test');
    expect(safeHref('tel:+79166550606')).toBe('tel:+79166550606');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.test', 'ftp://x.test', 'https://a.test/ x', ' ', '/\\evil']) expect(safeHref(bad), bad).toBeNull();
    expect(safeImageSrc('/api/catalog/media/a-1.webp')).toBe('/api/catalog/media/a-1.webp');
    expect(safeImageSrc('/api/catalog/media/../x')).toBeNull();
    expect(safeImageSrc('https://x.test/a.png')).toBeNull();
  });

  it('разбор не падает на мусоре и пустом вводе', () => {
    expect(parseBody('')).toEqual([]);
    expect(() => parseBody('[[[](((\n**\n*\n![](\n> \n- \n## ')).not.toThrow();
  });
});
