import { splitSeoText } from '@/domain/catalog/categories';

/** SEO-текст под сеткой товаров: простой текст, абзацы через пустую строку; React экранирует всё, HTML не поддерживается. Пусто — блока нет. */
export function CategorySeoText({ name, text }: { name: string; text: string | null }) {
  const paragraphs = splitSeoText(text);
  if (paragraphs.length === 0) return null;
  return (
    <section className="seo-text" aria-label={`О категории «${name}»`}>
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </section>
  );
}
