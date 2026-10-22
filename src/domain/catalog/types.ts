/** Типы витрины каталога. Деньги — целые копейки. */

export type SortKey = 'name' | 'popular' | 'price_asc' | 'price_desc' | 'relevance';

export const SORT_LABELS: Record<Exclude<SortKey, 'relevance'>, string> = {
  name: 'По названию',
  popular: 'По популярности',
  price_asc: 'Сначала дешевле',
  price_desc: 'Сначала дороже',
};

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 60;
export const MAX_QUERY_LENGTH = 100;
/** Правило фильтров: характеристика — фильтр категории при ≥3 товарах и ≤30 значениях. */
export const FACET_MIN_PRODUCTS = 3;
export const FACET_MAX_VALUES = 30;

export type CatalogQuery = {
  /** Категория вместе с подкатегориями. */
  categorySlug?: string;
  text?: string;
  /** Ключ — id характеристики (attribute_definitions.id) строкой, значения — выбранные значения (ИЛИ внутри, И между). */
  filters: Record<string, string[]>;
  /** Цена за единицу (с учётом скидочной) в копейках. */
  priceMin?: number;
  priceMax?: number;
  inStockOnly?: boolean;
  /** По умолчанию: 'relevance' при тексте, иначе 'name'. */
  sort: SortKey;
  page: number;
  pageSize?: number;
};

export type CatalogImage = {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  /** true — внешний URL (локальной копии ещё нет). */
  remote: boolean;
};

export type ProductCard = {
  id: number;
  slug: string;
  name: string;
  sku: string | null;
  /** Цена к оплате за единицу. */
  unitKopecks: number;
  /** Обычная цена, только если действует реальная скидочная. */
  originalKopecks?: number;
  inStock: boolean;
  image: CatalogImage | null;
};

export type SearchResult = { items: ProductCard[]; total: number; page: number; pageSize: number; hasMore: boolean };

export type FacetValue = { value: string; count: number };
export type Facet = { id: number; name: string; values: FacetValue[] };

/** Контекст выбора, под который считаются счётчики фасетов. */
export type FacetContext = Pick<CatalogQuery, 'text' | 'filters' | 'priceMin' | 'priceMax' | 'inStockOnly'>;

export type CategoryNode = {
  id: number;
  slug: string;
  name: string;
  parentId: number | null;
  /** Опубликованные товары категории вместе с подкатегориями. */
  productCount: number;
  children: CategoryNode[];
};

export type CategoryInfo = {
  id: number;
  slug: string;
  name: string;
  h1: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoText: string | null;
  parentId: number | null;
};

export type Breadcrumb = { name: string; href: string };

export type ProductPage = {
  id: number;
  slug: string;
  name: string;
  sku: string | null;
  /** Санитизированный HTML (T02), безопасно выводить как HTML. */
  descriptionHtml: string | null;
  unitKopecks: number;
  originalKopecks?: number;
  inStock: boolean;
  category: CategoryInfo;
  breadcrumbs: Breadcrumb[];
  images: CatalogImage[];
  /** Мелкие превью к images (тот же порядок). */
  thumbs: CatalogImage[];
  attributes: { name: string; value: string }[];
};
