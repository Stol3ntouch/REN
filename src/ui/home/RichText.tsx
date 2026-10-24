import { Fragment, type ReactNode } from 'react';
import { parseBody, parseInline, type Block, type Inline } from '@/domain/content/markup';
import { Placeholder } from '../placeholder';

/**
 * Текст страниц и записей из админки. Это не HTML: разметка не выполняется (нет XSS). Синтаксис и список допустимых
 * ссылок/картинок — в domain/content/markup.ts: заголовки (## … ####), абзацы, **жирный**, *курсив*, [ссылки](…),
 * списки (- и 1.), цитаты (>), разделитель (---), изображения из хранилища загрузок и метки «[… — впиши]».
 * Любой другой текст, включая теги, выводится как обычный экранированный текст.
 */
function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={i}>{n.v}</Fragment>;
      case 'br':
        return <br key={i} />;
      case 'strong':
        return <strong key={i}>{renderInline(n.c)}</strong>;
      case 'em':
        return <em key={i}>{renderInline(n.c)}</em>;
      case 'link': {
        const external = /^https?:/i.test(n.href);
        return (
          <a key={i} href={n.href} {...(external ? { rel: 'noopener noreferrer nofollow', target: '_blank' } : {})}>
            {renderInline(n.c)}
          </a>
        );
      }
      case 'label':
        return <Placeholder key={i} label={n.label} verb={n.verb} />;
    }
  });
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.t) {
    case 'heading': {
      const Tag = `h${b.level}` as 'h2' | 'h3' | 'h4';
      return <Tag key={i}>{renderInline(b.c)}</Tag>;
    }
    case 'paragraph':
      return <p key={i}>{renderInline(b.c)}</p>;
    case 'quote':
      return <blockquote key={i}>{renderInline(b.c)}</blockquote>;
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul';
      return (
        <Tag key={i}>
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </Tag>
      );
    }
    case 'image':
      return (
        <figure key={i} className="content-figure">
          {/* eslint-disable-next-line @next/next/no-img-element -- локальный файл из хранилища загрузок, адрес проверен markup.safeImageSrc */}
          <img src={b.src} alt={b.alt} loading="lazy" decoding="async" />
          {b.alt ? <figcaption>{b.alt}</figcaption> : null}
        </figure>
      );
    case 'rule':
      return <hr key={i} />;
  }
}

export function RichText({ text, className }: { text: string; className?: string }) {
  return <div className={className ?? 'rich-text'}>{parseBody(text).map(renderBlock)}</div>;
}

/** Строка как строчная разметка (для коротких подписей с метками). */
export function InlineText({ text }: { text: string }) {
  return <>{renderInline(parseInline(text))}</>;
}

/** Первые абзацы текста до max символов (для анонсов): заголовки, списки, картинки и разделители пропускаются. */
export function excerptText(text: string, max = 450): string {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b !== '' && !/^(#{2,4} |[-*] |\d{1,3}\. |> |!\[|---)/.test(b));
  let out = '';
  for (const b of paragraphs) {
    if (out !== '' && out.length + b.length > max) break;
    out = out === '' ? b : `${out}\n\n${b}`;
    if (out.length >= max) break;
  }
  return out;
}
