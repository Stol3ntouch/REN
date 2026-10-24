import { makeContentRepo } from './content-base';

export type ServiceRow = {
  id: number;
  slug: string;
  title: string;
  h1: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  summary: string | null;
  body: string;
  /** Условие стоимости текстом («от …», «по договорённости») — только если его ввёл админ. */
  priceText: string | null;
  imagePath: string | null;
  imageVariants: string | null;
  imageAlt: string | null;
  categoryId: number | null;
  published: boolean;
  sort: number;
  updatedAt: number;
};
export type ServiceWrite = Partial<Omit<ServiceRow, 'id' | 'updatedAt'>>;

export const servicesRepo = makeContentRepo<ServiceRow, ServiceWrite>({
  table: 'services',
  columns: ['slug', 'title', 'h1', 'seoTitle', 'seoDescription', 'summary', 'body', 'priceText', 'imagePath', 'imageVariants', 'imageAlt', 'categoryId', 'published', 'sort'],
  booleans: ['published'],
  order: 'sort, id',
});
