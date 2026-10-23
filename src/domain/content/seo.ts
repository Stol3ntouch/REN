import type { Metadata } from 'next';
import type { CatalogImage } from '@/domain/catalog/types';

/** SEO-поля контента → Metadata Next.js: title, description, canonical, Open Graph. */
export type SeoInput = {
  /** SEO title, если задан; иначе обычный заголовок. */
  seoTitle?: string | null;
  title: string;
  seoDescription?: string | null;
  /** Запасное описание (например, начало текста). */
  fallbackDescription?: string | null;
  /** Адрес страницы на сайте (канонический), с ведущим «/». */
  path: string;
  image?: CatalogImage | null;
  type?: 'website' | 'article';
};

/** Первые max символов текста без разметки-заглушек: для description по умолчанию. */
export function plainExcerpt(text: string | null | undefined, max = 160): string | undefined {
  if (!text) return undefined;
  const clean = text
    .replace(/\[[^\]]*—\s*(?:впиши|загрузи)\]/g, ' ')
    .replace(/^#+\s*/gm, '')
    .replace(/^-\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean === '') return undefined;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function contentMetadata(input: SeoInput): Metadata {
  const title = input.seoTitle?.trim() || input.title;
  const description = input.seoDescription?.trim() || input.fallbackDescription?.trim() || undefined;
  return {
    title,
    description,
    alternates: { canonical: input.path },
    openGraph: {
      title,
      description,
      url: input.path,
      siteName: 'РемТехСад',
      locale: 'ru_RU',
      type: input.type ?? 'website',
      ...(input.image ? { images: [{ url: input.image.src, alt: input.image.alt }] } : {}),
    },
  };
}
