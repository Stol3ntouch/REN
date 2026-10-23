import { makeContentRepo } from './content-base';

export type PromotionRow = {
  id: number;
  slug: string;
  title: string;
  h1: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  summary: string | null;
  body: string;
  imagePath: string | null;
  imageVariants: string | null;
  imageAlt: string | null;
  promoCode: string | null;
  startsAt: number | null;
  endsAt: number | null;
  published: boolean;
  sort: number;
  updatedAt: number;
};
export type PromotionWrite = Partial<Omit<PromotionRow, 'id' | 'updatedAt'>>;

export const promotionsRepo = makeContentRepo<PromotionRow, PromotionWrite>({
  table: 'promotions',
  columns: [
    'slug', 'title', 'h1', 'seoTitle', 'seoDescription', 'summary', 'body', 'imagePath', 'imageVariants', 'imageAlt',
    'promoCode', 'startsAt', 'endsAt', 'published', 'sort',
  ],
  booleans: ['published'],
  order: 'sort, id DESC',
});
