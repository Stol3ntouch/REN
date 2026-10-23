import { Fragment, type ReactNode } from 'react';
import { Placeholder } from '../placeholder';

/**
 * Текст страниц и записей из админки. Это не HTML: разметка не выполняется (нет XSS), только:
 * пустая строка — новый абзац, «## » — подзаголовок, строки с «- » — список,
 * «[МЕТКА — впиши]» — заметная метка-заглушка.
 */
const LABEL = /\[([^\]\n]+?) — (впиши|загрузи)\]/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LABEL)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(<Placeholder key={at} label={m[1] as string} verb={m[2] as 'впиши' | 'загрузи'} />);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function lines(block: string): ReactNode[] {
  return block.split('\n').map((line, i, all) => (
    <Fragment key={i}>
      {inline(line)}
      {i < all.length - 1 ? <br /> : null}
    </Fragment>
  ));
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b !== '');
  return (
    <div className={className ?? 'rich-text'}>
      {blocks.map((block, i) => {
        if (block.startsWith('## ')) return <h2 key={i}>{inline(block.slice(3).split('\n')[0] as string)}</h2>;
        const rows = block.split('\n');
        if (rows.every((r) => r.startsWith('- '))) {
          return (
            <ul key={i}>
              {rows.map((r, j) => (
                <li key={j}>{inline(r.slice(2))}</li>
              ))}
            </ul>
          );
        }
        // «## Заголовок» в начале блока и текст следом
        if (rows[0]?.startsWith('## ')) {
          return (
            <Fragment key={i}>
              <h2>{inline(rows[0].slice(3))}</h2>
              <p>{lines(rows.slice(1).join('\n'))}</p>
            </Fragment>
          );
        }
        return <p key={i}>{lines(block)}</p>;
      })}
    </div>
  );
}

/** Первые абзацы текста до max символов (для анонсов). Метки не режутся посередине. */
export function excerptText(text: string, max = 450): string {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b !== '' && !b.startsWith('## '));
  let out = '';
  for (const b of blocks) {
    if (out !== '' && out.length + b.length > max) break;
    out = out === '' ? b : `${out}\n\n${b}`;
    if (out.length >= max) break;
  }
  return out;
}
