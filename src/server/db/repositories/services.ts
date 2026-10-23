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
  priceText: string | null;
  imagePath: string | null;
  imageVariants: string | null;
  imageAlt: string | null;
  published: boolean;
  sort: number;
  updatedAt: number;
};
export type ServiceWrite = Partial<Omit<ServiceRow, 'id' | 'updatedAt'>>;

export const servicesRepo = makeContentRepo<ServiceRow, ServiceWrite>({
  table: 'services',
  columns: ['slug', 'title', 'h1', 'seoTitle', 'seoDescription', 'summary', 'body', 'priceText', 'imagePath', 'imageVariants', 'imageAlt', 'published', 'sort'],
  booleans: ['published'],
  order: 'sort, id',
});
