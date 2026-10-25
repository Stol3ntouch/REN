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
  /** Название сайта в Open Graph (настройка «Название сайта»); по умолчанию «РемТехСад». */
  siteName?: string;
  /** Задан админом: канонический адрес вместо path. */
  canonical?: string | null;
  /** Закрыть страницу от индексации (robots noindex). */
  noindex?: boolean;
};

/** Первые max символов текста без разметки-заглушек: для description по умолчанию. */
export function plainExcerpt(text: string | null | undefined, max = 160): string | undefined {
  if (!text) return undefined;
  const clean = text
    .replace(/\[[^\]]*—\s*(?:впиши|загрузи)\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*{1,2}([^*\n]+)\*{1,2}/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^(?:[-*]|\d{1,3}\.)\s+/gm, '')
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
    alternates: { canonical: input.canonical?.trim() || input.path },
    ...(input.noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title,
      description,
      url: input.path,
      siteName: input.siteName ?? 'РемТехСад',
      locale: 'ru_RU',
      type: input.type ?? 'website',
      ...(input.image ? { images: [{ url: input.image.src, alt: input.image.alt }] } : {}),
    },
  };
}
