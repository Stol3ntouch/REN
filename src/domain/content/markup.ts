import { MEDIA_BASE } from '@/domain/catalog/images';

/**
 * Формат содержимого страниц, новостей, акций и услуг — расширенный Markdown БЕЗ сырого HTML.
 * Текст разбирается в дерево блоков; любые теги, атрибуты и обработчики событий остаются обычным текстом
 * (React экранирует его при выводе), поэтому XSS через содержимое невозможен.
 *
 * Синтаксис (по одному элементу на строку/блок, блоки разделяются пустой строкой):
 *   ## Заголовок, ### Подзаголовок, #### Малый заголовок
 *   абзац (строки внутри абзаца — с переносом); **жирный**, *курсив*, [текст](ссылка)
 *   - пункт, * пункт  → маркированный список;   1. пункт → нумерованный список
 *   > цитата;   ---   → разделитель
 *   ![подпись](/api/catalog/media/<файл>)  → изображение, загруженное через админку (другие адреса не принимаются)
 *   [ЧТО-ТО — впиши] / [ЧТО-ТО — загрузи]  → заметная метка-заглушка
 * Ссылки: только http(s), mailto:, tel:, путь на сайте (/…) и якорь (#…); javascript:, data: и прочее выводится текстом.
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'label'; label: string; verb: 'впиши' | 'загрузи' };

export type Block =
  | { t: 'heading'; level: 2 | 3 | 4; c: Inline[] }
  | { t: 'paragraph'; c: Inline[] }
  | { t: 'list'; ordered: boolean; items: Inline[][] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'image'; src: string; alt: string }
  | { t: 'rule' };

const MAX_LINK = 2000;

/** Безопасная ссылка или null. Пробелы/управляющие символы и схемы кроме разрешённых отклоняются. */
export function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (url === '' || url.length > MAX_LINK) return null;
  if (/[\s\u0000-\u001f\u007f]/.test(url)) return null;
  if (url.startsWith('#')) return /^#[\w-]*$/.test(url) ? url : null;
  if (url.startsWith('/')) return url.startsWith('//') || url.startsWith('/\\') ? null : url;
  if (/^https?:\/\/[^\s/?#]+/i.test(url)) return url;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(url)) return url;
  if (/^tel:[+\d\-() ]+$/i.test(url)) return url;
  return null;
}

/** Адрес картинки допустим, только если это файл из хранилища загрузок (MEDIA_BASE) без обхода каталогов. */
export function safeImageSrc(raw: string): string | null {
  const url = raw.trim();
  if (!url.startsWith(`${MEDIA_BASE}/`)) return null;
  const rest = url.slice(MEDIA_BASE.length + 1);
  if (rest === '' || rest.includes('..') || rest.includes('\\') || !/^[\w.\-%/]+$/.test(rest)) return null;
  return url;
}

const LABEL = /\[([^\]\n]+?) — (впиши|загрузи)\]/y;
const LINK = /\[([^\]\n]+)\]\(([^)\s]*)\)/y;

/** Разбор строки в строчные элементы. noLinks — внутри ссылки вложенные ссылки не строим. */
export function parseInline(text: string, noLinks = false): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf !== '') out.push({ t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === '[') {
      LABEL.lastIndex = i;
      const lm = LABEL.exec(text);
      if (lm) {
        flush();
        out.push({ t: 'label', label: lm[1] as string, verb: lm[2] as 'впиши' | 'загрузи' });
        i += lm[0].length;
        continue;
      }
      if (!noLinks) {
        LINK.lastIndex = i;
        const m = LINK.exec(text);
        if (m) {
          const href = safeHref(m[2] as string);
          flush();
          const inner = parseInline(m[1] as string, true);
          if (href) out.push({ t: 'link', href, c: inner });
          else out.push(...inner);
          i += m[0].length;
          continue;
        }
      }
    }
    if (ch === '*') {
      if (text.startsWith('**', i)) {
        const end = text.indexOf('**', i + 2);
        if (end > i + 2 && !/^\s|\s$/.test(text.slice(i + 2, end))) {
          flush();
          out.push({ t: 'strong', c: parseInline(text.slice(i + 2, end), noLinks) });
          i = end + 2;
          continue;
        }
      } else {
        const end = text.indexOf('*', i + 1);
        if (end > i + 1 && text[end + 1] !== '*' && !/^\s|\s$/.test(text.slice(i + 1, end))) {
          flush();
          out.push({ t: 'em', c: parseInline(text.slice(i + 1, end), noLinks) });
          i = end + 1;
          continue;
        }
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

const HEADING = /^(#{2,4}) +(.+)$/;
const IMAGE = /^!\[([^\]\n]*)\]\(([^)\s]*)\)\s*$/;
const BULLET = /^[-*] +(.*)$/;
const ORDERED = /^\d{1,3}\. +(.*)$/;
const QUOTE = /^> ?(.*)$/;
const RULE = /^-{3,}\s*$/;

function withBreaks(lines: string[]): Inline[] {
  const out: Inline[] = [];
  lines.forEach((line, i) => {
    out.push(...parseInline(line));
    if (i < lines.length - 1) out.push({ t: 'br' });
  });
  return out;
}

/** Текст → блоки. Не бросает на любом вводе. */
export function parseBody(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  type Open = { kind: 'p'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] } | { kind: 'q'; lines: string[] } | null;
  let open: Open = null;
  const flush = () => {
    if (!open) return;
    if (open.kind === 'p') blocks.push({ t: 'paragraph', c: withBreaks(open.lines) });
    else if (open.kind === 'q') blocks.push({ t: 'quote', c: withBreaks(open.lines) });
    else blocks.push({ t: 'list', ordered: open.kind === 'ol', items: open.items.map((i) => parseInline(i)) });
    open = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flush();
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      blocks.push({ t: 'heading', level: (h[1] as string).length as 2 | 3 | 4, c: parseInline(h[2] as string) });
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ t: 'rule' });
      continue;
    }
    const img = IMAGE.exec(line);
    if (img) {
      flush();
      const src = safeImageSrc(img[2] as string);
      if (src) blocks.push({ t: 'image', src, alt: (img[1] as string).trim() });
      continue;
    }
    const b = BULLET.exec(line);
    if (b) {
      if (open?.kind === 'ul') open.items.push(b[1] as string);
      else {
        flush();
        open = { kind: 'ul', items: [b[1] as string] };
      }
      continue;
    }
    const o = ORDERED.exec(line);
    if (o) {
      if (open?.kind === 'ol') open.items.push(o[1] as string);
      else {
        flush();
        open = { kind: 'ol', items: [o[1] as string] };
      }
      continue;
    }
    const q = QUOTE.exec(line);
    if (q) {
      if (open?.kind === 'q') open.lines.push(q[1] as string);
      else {
        flush();
        open = { kind: 'q', lines: [q[1] as string] };
      }
      continue;
    }
    if (open?.kind === 'p') open.lines.push(line);
    else {
      flush();
      open = { kind: 'p', lines: [line] };
    }
  }
  flush();
  return blocks;
}

/** Текст без разметки (для описаний и анонсов). */
export function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
          return n.v;
        case 'br':
          return ' ';
        case 'label':
          return '';
        default:
          return 'c' in n ? inlineText(n.c) : '';
      }
    })
    .join('');
}

export function blocksText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.t) {
        case 'heading':
        case 'paragraph':
        case 'quote':
          return inlineText(b.c);
        case 'list':
          return b.items.map(inlineText).join(' ');
        default:
          return '';
      }
    })
    .filter((s) => s.trim() !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
