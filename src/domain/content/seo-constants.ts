/** Справочники страницы «SEO и метаданные»: чистые константы (их импортирует и клиентская форма). */
export const SEO_SECTIONS = ['products', 'categories', 'pages', 'news', 'services'] as const;
export type SeoSection = (typeof SEO_SECTIONS)[number];
export const SEO_SECTION_LABELS: Record<SeoSection, string> = {
  products: 'Товары',
  categories: 'Категории',
  pages: 'Страницы',
  news: 'Новости',
  services: 'Услуги',
};
export const CHANGE_FREQUENCIES = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'] as const;
export type ChangeFrequency = (typeof CHANGE_FREQUENCIES)[number];

export const TEMPLATE_VARIABLES = ['name', 'brand', 'category', 'price', 'site'] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export const TEMPLATE_VARIABLE_HINT = '{name} {brand} {category} {price} {site}';
