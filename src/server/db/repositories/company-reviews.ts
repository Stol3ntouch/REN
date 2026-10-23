import { makeContentRepo } from './content-base';

export type CompanyReviewRow = {
  id: number;
  authorName: string;
  body: string;
  rating: number | null;
  reviewedAt: number | null;
  published: boolean;
  sort: number;
  updatedAt: number;
};
export type CompanyReviewWrite = Partial<Omit<CompanyReviewRow, 'id' | 'updatedAt'>>;

export const companyReviewsRepo = makeContentRepo<CompanyReviewRow, CompanyReviewWrite>({
  table: 'company_reviews',
  columns: ['authorName', 'body', 'rating', 'reviewedAt', 'published', 'sort'],
  booleans: ['published'],
  order: 'sort, COALESCE(reviewed_at, updated_at) DESC, id DESC',
});
