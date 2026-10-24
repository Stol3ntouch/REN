import Link from 'next/link';

/** Полоса над шапкой: текст ровно такой, как ввёл администратор (баннер позиции top_strip); ссылка необязательна. */
export function TopStrip({ text, href }: { text: string; href?: string }) {
  const inner = href ? (href.startsWith('/') ? <Link href={href}>{text}</Link> : <a href={href} rel="noopener noreferrer">{text}</a>) : text;
  return (
    <div className="top-strip" role="region" aria-label="Объявление">
      {inner}
    </div>
  );
}
