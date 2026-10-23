import { makeContentRepo } from './content-base';

export type SlideRow = {
  id: number;
  title: string;
  subtitle: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  imagePath: string | null;
  imageVariants: string | null;
  imageAlt: string | null;
  active: boolean;
  sort: number;
  updatedAt: number;
};
export type SlideWrite = Partial<Omit<SlideRow, 'id' | 'updatedAt'>>;

export const MAX_SLIDES = 3;

export const slidesRepo = makeContentRepo<SlideRow, SlideWrite>({
  table: 'slides',
  columns: ['title', 'subtitle', 'linkUrl', 'linkLabel', 'imagePath', 'imageVariants', 'imageAlt', 'active', 'sort'],
  booleans: ['active'],
  order: 'sort, id',
});
