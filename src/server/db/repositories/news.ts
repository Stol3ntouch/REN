import { makeContentRepo } from './content-base';

export type NewsRow = {
  id: number;
  slug: string;
  title: string;
  h1: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  excerpt: string | null;
  body: string;
  imagePath: string | null;
  imageVariants: string | null;
  imageAlt: string | null;
  published: boolean;
  publishedAt: number | null;
  updatedAt: number;
};
export type NewsWrite = Partial<Omit<NewsRow, 'id' | 'updatedAt'>>;

export const newsRepo = makeContentRepo<NewsRow, NewsWrite>({
  table: 'news',
  columns: ['slug', 'title', 'h1', 'seoTitle', 'seoDescription', 'excerpt', 'body', 'imagePath', 'imageVariants', 'imageAlt', 'published', 'publishedAt'],
  booleans: ['published'],
  order: 'COALESCE(published_at, updated_at) DESC, id DESC',
});
