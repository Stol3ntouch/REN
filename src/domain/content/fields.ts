/**
 * Описание полей форм админки «Контент и услуги». Один источник и для формы (страницы /admin/content/*),
 * и для разбора запроса в обработчике сохранения: имя поля формы = имя поля входа contentOps.
 */
export const ENTITY_KEYS = ['settings', 'pages', 'slides', 'news', 'services', 'promotions', 'reviews'] as const;
export type EntityKey = (typeof ENTITY_KEYS)[number];

export function isEntityKey(v: string): v is EntityKey {
  return (ENTITY_KEYS as readonly string[]).includes(v);
}

export const ENTITY_LABELS: Record<EntityKey, { title: string; singular: string; hint: string }> = {
  settings: { title: 'Настройки магазина', singular: 'настройки', hint: 'Адрес, телефон, часы, координаты, соцсети, логотип, SEO главной' },
  pages: { title: 'Страницы', singular: 'страница', hint: 'О компании, доставка и оплата, гарантия, FAQ, условия, политика данных' },
  slides: { title: 'Слайды главной', singular: 'слайд', hint: 'Не больше трёх' },
  news: { title: 'Новости', singular: 'новость', hint: 'Раздел скрыт, пока нет опубликованных новостей' },
  services: { title: 'Услуги', singular: 'услуга', hint: 'Список и отдельная страница каждой услуги' },
  promotions: { title: 'Акции', singular: 'акция', hint: 'Список и страница акции, промокод для ввода в корзине' },
  reviews: { title: 'Отзывы о компании', singular: 'отзыв', hint: 'Вносит и публикует администратор' },
};

export type FieldKind = 'text' | 'textarea' | 'bool' | 'int' | 'date' | 'file';
export type FieldSpec = {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  maxLength?: number;
  hint?: string;
  /** date: конец дня (включительно), а не начало. */
  endOfDay?: boolean;
};

const seo = (): FieldSpec[] => [
  { name: 'slug', label: 'Адрес (slug)', kind: 'text', maxLength: 100, hint: 'Латиница, цифры и дефисы; пусто — по названию' },
  { name: 'h1', label: 'Заголовок H1', kind: 'text', maxLength: 200, hint: 'Пусто — берётся название' },
  { name: 'seoTitle', label: 'SEO title', kind: 'text', maxLength: 200 },
  { name: 'seoDescription', label: 'SEO description', kind: 'textarea', maxLength: 400 },
];
const imageFields = (): FieldSpec[] => [
  { name: 'image', label: 'Изображение (JPEG, PNG или WebP, до 5 МБ)', kind: 'file' },
  { name: 'imageAlt', label: 'Подпись изображения (alt)', kind: 'text', maxLength: 200 },
];

export const ENTITY_FIELDS: Record<EntityKey, FieldSpec[]> = {
  settings: [
    { name: 'phone', label: 'Телефон', kind: 'text', maxLength: 40 },
    { name: 'address', label: 'Адрес', kind: 'text', maxLength: 300 },
    { name: 'work_hours', label: 'Часы работы', kind: 'text', maxLength: 200 },
    { name: 'email', label: 'Публичная электронная почта', kind: 'text', maxLength: 200, hint: 'Для показа на сайте. Получатели писем — в разделе «Доступ и настройки»' },
    { name: 'latitude', label: 'Широта', kind: 'text', maxLength: 20, hint: 'Например 55.751244. Без координат карта не показывается' },
    { name: 'longitude', label: 'Долгота', kind: 'text', maxLength: 20, hint: 'Например 37.618423' },
    { name: 'social_vk', label: 'ВКонтакте (ссылка)', kind: 'text', maxLength: 300 },
    { name: 'social_telegram', label: 'Telegram (ссылка)', kind: 'text', maxLength: 300 },
    { name: 'social_whatsapp', label: 'WhatsApp (ссылка)', kind: 'text', maxLength: 300 },
    { name: 'social_youtube', label: 'YouTube (ссылка)', kind: 'text', maxLength: 300 },
    { name: 'requisites', label: 'Реквизиты (подвал)', kind: 'textarea', maxLength: 2000 },
    { name: 'delivery_payment_text', label: 'Доставка и оплата на карточке товара', kind: 'textarea', maxLength: 3000, hint: 'Пусто — на карточке метка-заглушка' },
    { name: 'home_h1', label: 'Главная: заголовок H1', kind: 'text', maxLength: 200 },
    { name: 'home_title', label: 'Главная: SEO title', kind: 'text', maxLength: 200 },
    { name: 'home_description', label: 'Главная: SEO description', kind: 'textarea', maxLength: 400 },
    { name: 'logo', label: 'Логотип (JPEG, PNG или WebP, до 5 МБ)', kind: 'file', hint: 'Заменяет логотип по умолчанию' },
  ],
  pages: [
    { name: 'title', label: 'Название', kind: 'text', required: true, maxLength: 200 },
    { name: 'slug', label: 'Адрес (slug)', kind: 'text', required: true, maxLength: 100 },
    { name: 'h1', label: 'Заголовок H1', kind: 'text', maxLength: 200, hint: 'Пусто — берётся название' },
    { name: 'seoTitle', label: 'SEO title', kind: 'text', maxLength: 200 },
    { name: 'seoDescription', label: 'SEO description', kind: 'textarea', maxLength: 400 },
    { name: 'body', label: 'Текст', kind: 'textarea', maxLength: 50000, hint: 'Абзацы — через пустую строку; «## » — подзаголовок; «- » — пункт списка' },
    { name: 'legalDraft', label: 'Показывать метку «ЧЕРНОВИК — проверить юристом»', kind: 'bool' },
  ],
  slides: [
    { name: 'title', label: 'Заголовок', kind: 'text', required: true, maxLength: 120 },
    { name: 'subtitle', label: 'Подзаголовок', kind: 'textarea', maxLength: 300 },
    { name: 'linkUrl', label: 'Ссылка', kind: 'text', maxLength: 300, hint: 'Путь на сайте (/catalog) или адрес https://…' },
    { name: 'linkLabel', label: 'Текст кнопки', kind: 'text', maxLength: 60 },
    ...imageFields(),
    { name: 'sort', label: 'Порядок', kind: 'int' },
    { name: 'active', label: 'Показывать', kind: 'bool' },
  ],
  news: [
    { name: 'title', label: 'Название', kind: 'text', required: true, maxLength: 200 },
    ...seo(),
    { name: 'excerpt', label: 'Краткое описание', kind: 'textarea', maxLength: 400 },
    { name: 'body', label: 'Текст', kind: 'textarea', maxLength: 50000 },
    ...imageFields(),
    { name: 'publishedAt', label: 'Дата публикации', kind: 'date', hint: 'Пусто — день сохранения' },
    { name: 'published', label: 'Опубликована', kind: 'bool' },
  ],
  services: [
    { name: 'title', label: 'Название', kind: 'text', required: true, maxLength: 200 },
    ...seo(),
    { name: 'summary', label: 'Краткое описание', kind: 'textarea', maxLength: 400 },
    { name: 'body', label: 'Текст', kind: 'textarea', maxLength: 50000 },
    { name: 'priceText', label: 'Цена (текстом)', kind: 'text', maxLength: 100, hint: 'Показывается, только если заполнено' },
    ...imageFields(),
    { name: 'sort', label: 'Порядок', kind: 'int' },
    { name: 'published', label: 'Опубликована', kind: 'bool' },
  ],
  promotions: [
    { name: 'title', label: 'Название', kind: 'text', required: true, maxLength: 200 },
    ...seo(),
    { name: 'summary', label: 'Краткое описание', kind: 'textarea', maxLength: 400 },
    { name: 'body', label: 'Условия акции', kind: 'textarea', maxLength: 50000 },
    { name: 'promoCode', label: 'Промокод для показа', kind: 'text', maxLength: 32, hint: 'Сам промокод заводится в «Цены и акции»' },
    { name: 'startsAt', label: 'Действует с', kind: 'date' },
    { name: 'endsAt', label: 'Действует по (включительно)', kind: 'date', endOfDay: true },
    ...imageFields(),
    { name: 'sort', label: 'Порядок', kind: 'int' },
    { name: 'published', label: 'Опубликована', kind: 'bool' },
  ],
  reviews: [
    { name: 'authorName', label: 'Имя автора', kind: 'text', required: true, maxLength: 100 },
    { name: 'body', label: 'Текст отзыва', kind: 'textarea', required: true, maxLength: 2000 },
    { name: 'rating', label: 'Оценка 1–5 (необязательно)', kind: 'int' },
    { name: 'reviewedAt', label: 'Дата отзыва', kind: 'date' },
    { name: 'sort', label: 'Порядок', kind: 'int' },
    { name: 'published', label: 'Опубликован', kind: 'bool' },
  ],
};
