/**
 * Описание полей форм админки «Контент». Один источник и для формы (страницы /admin/content/*),
 * и для разбора запроса в обработчике сохранения: имя поля формы = имя поля входа contentOps.
 */
export const ENTITY_KEYS = ['settings', 'pages', 'banners', 'news', 'news-categories', 'services', 'service-categories', 'promotions', 'reviews'] as const;
export type EntityKey = (typeof ENTITY_KEYS)[number];

/** Сущности со списком и формой правки на DataTable (все, кроме настроек магазина и отзывов о компании). */
export const LIST_ENTITY_KEYS = ['pages', 'banners', 'news', 'news-categories', 'services', 'service-categories', 'promotions', 'reviews'] as const;
export type ListEntityKey = (typeof LIST_ENTITY_KEYS)[number];

export function isEntityKey(v: string): v is EntityKey {
  return (ENTITY_KEYS as readonly string[]).includes(v);
}
export function isListEntityKey(v: string): v is ListEntityKey {
  return (LIST_ENTITY_KEYS as readonly string[]).includes(v);
}

/** Ключ в contentOps (кебаб в адресе → camelCase в коде). */
export const OPS_KEY: Record<EntityKey, 'settings' | 'pages' | 'banners' | 'news' | 'newsCategories' | 'services' | 'serviceCategories' | 'promotions' | 'reviews'> = {
  settings: 'settings',
  pages: 'pages',
  banners: 'banners',
  news: 'news',
  'news-categories': 'newsCategories',
  services: 'services',
  'service-categories': 'serviceCategories',
  promotions: 'promotions',
  reviews: 'reviews',
};

export const ENTITY_LABELS: Record<EntityKey, { title: string; singular: string; hint: string }> = {
  settings: { title: 'Настройки магазина', singular: 'настройки', hint: 'Адрес, телефон, координаты, соцсети, логотип, SEO главной' },
  pages: { title: 'Страницы', singular: 'страница', hint: 'Системные страницы и свои: черновик, предпросмотр, отложенная публикация, версии' },
  banners: { title: 'Баннеры', singular: 'баннер', hint: 'Главная (до трёх активных), страница категории, полоса над шапкой' },
  news: { title: 'Новости', singular: 'новость', hint: 'Категории, автор, отложенная публикация' },
  'news-categories': { title: 'Категории новостей', singular: 'категория новостей', hint: 'Фильтр на странице «Новости»' },
  services: { title: 'Услуги и ремонт', singular: 'услуга', hint: 'Список и отдельная страница каждой услуги' },
  'service-categories': { title: 'Категории услуг', singular: 'категория услуг', hint: 'Фильтр на странице «Ремонт и услуги»' },
  promotions: { title: 'Акции', singular: 'акция', hint: 'Период, условия, скидка, участвующие товары и категории' },
  reviews: { title: 'Отзывы о компании', singular: 'отзыв', hint: 'Вносит и публикует администратор' },
};

export type FieldKind = 'text' | 'textarea' | 'bool' | 'int' | 'date' | 'datetime' | 'file' | 'select' | 'refselect' | 'intlist' | 'money';
export type FieldSpec = {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  maxLength?: number;
  hint?: string;
  /** date: конец дня (включительно), а не начало. */
  endOfDay?: boolean;
  /** select: допустимые значения. refselect / intlist: варианты подставляет страница. */
  options?: readonly { value: string; label: string }[];
  /** Заголовок группы полей в форме. */
  group?: string;
  /** Поле, которого нет в форме создания (только показ после сохранения). */
  hideOnCreate?: boolean;
};

const seo = (): FieldSpec[] => [
  { name: 'slug', label: 'Адрес (slug)', kind: 'text', maxLength: 100, hint: 'Латиница, цифры и дефисы; пусто — по названию', group: 'Адрес и SEO' },
  { name: 'h1', label: 'Заголовок H1', kind: 'text', maxLength: 200, hint: 'Пусто — берётся название', group: 'Адрес и SEO' },
  { name: 'seoTitle', label: 'SEO title', kind: 'text', maxLength: 200, group: 'Адрес и SEO' },
  { name: 'seoDescription', label: 'SEO description', kind: 'textarea', maxLength: 400, group: 'Адрес и SEO' },
];
const indexing = (): FieldSpec[] => [
  { name: 'canonical', label: 'Канонический адрес (canonical)', kind: 'text', maxLength: 300, hint: 'Пусто — адрес самой страницы', group: 'Адрес и SEO' },
  { name: 'noindex', label: 'Не показывать в поисковиках (noindex)', kind: 'bool', group: 'Адрес и SEO' },
];
const imageFields = (): FieldSpec[] => [
  { name: 'image', label: 'Изображение (JPEG, PNG или WebP, до 5 МБ)', kind: 'file', group: 'Изображение' },
  { name: 'imageAlt', label: 'Подпись изображения (alt)', kind: 'text', maxLength: 200, group: 'Изображение' },
];
const STATUS_OPTIONS = [
  { value: 'draft', label: 'Черновик' },
  { value: 'published', label: 'Опубликована' },
  { value: 'scheduled', label: 'Запланирована' },
] as const;

export const BANNER_POSITION_LABELS = {
  home_hero: 'Главная: слайдер (до трёх)',
  category: 'Страница категории',
  top_strip: 'Полоса над шапкой',
  home_middle: 'Главная: полоса между блоками',
} as const;

export const ENTITY_FIELDS: Record<EntityKey, FieldSpec[]> = {
  settings: [
    { name: 'phone', label: 'Телефон', kind: 'text', maxLength: 40 },
    { name: 'address', label: 'Адрес', kind: 'text', maxLength: 300 },
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
    { name: 'body', label: 'Содержимое', kind: 'textarea', maxLength: 50000, hint: 'Абзацы — через пустую строку; ## заголовок; - пункт; 1. пункт; > цитата; **жирный**; [ссылка](https://…); ![подпись](картинка из загрузки). HTML не выполняется.' },
    { name: 'status', label: 'Статус', kind: 'select', options: STATUS_OPTIONS, group: 'Публикация' },
    { name: 'publishedAt', label: 'Дата и время публикации (МСК)', kind: 'datetime', hint: 'Для «Запланирована» — в будущем; страница появится сама', group: 'Публикация' },
    { name: 'legalDraft', label: 'Показывать метку «ЧЕРНОВИК — проверить юристом»', kind: 'bool', group: 'Публикация' },
    { name: 'slug', label: 'Адрес (slug)', kind: 'text', maxLength: 100, hint: 'Свои страницы открываются по адресу /pages/<slug>; пусто — по названию', group: 'Адрес и SEO' },
    { name: 'h1', label: 'Заголовок H1', kind: 'text', maxLength: 200, hint: 'Пусто — берётся название', group: 'Адрес и SEO' },
    { name: 'seoTitle', label: 'SEO title', kind: 'text', maxLength: 200, group: 'Адрес и SEO' },
    { name: 'seoDescription', label: 'SEO description', kind: 'textarea', maxLength: 400, group: 'Адрес и SEO' },
    ...indexing(),
  ],
  banners: [
    { name: 'title', label: 'Название (для списка)', kind: 'text', required: true, maxLength: 120 },
    { name: 'position', label: 'Позиция', kind: 'select', options: Object.entries(BANNER_POSITION_LABELS).map(([value, label]) => ({ value, label })) },
    { name: 'status', label: 'Статус', kind: 'select', options: [{ value: 'active', label: 'Активен' }, { value: 'inactive', label: 'Отключён' }] },
    { name: 'heading', label: 'Заголовок', kind: 'text', maxLength: 200, group: 'Тексты' },
    { name: 'subheading', label: 'Подзаголовок', kind: 'textarea', maxLength: 300, group: 'Тексты' },
    { name: 'buttonText', label: 'Текст кнопки', kind: 'text', maxLength: 60, group: 'Тексты' },
    { name: 'url', label: 'Ссылка', kind: 'text', maxLength: 300, hint: 'Путь на сайте (/catalog) или адрес https://…', group: 'Тексты' },
    { name: 'image', label: 'Изображение (JPEG, PNG или WebP, до 5 МБ)', kind: 'file', group: 'Изображения' },
    { name: 'mobileImage', label: 'Изображение для телефона (необязательно)', kind: 'file', group: 'Изображения' },
    { name: 'alt', label: 'Подпись изображения (alt)', kind: 'text', maxLength: 200, group: 'Изображения' },
    { name: 'startsAt', label: 'Показывать с', kind: 'datetime', hint: 'Пусто — сразу (время московское)', group: 'Период и порядок' },
    { name: 'endsAt', label: 'Показывать до', kind: 'datetime', group: 'Период и порядок' },
    { name: 'sort', label: 'Порядок', kind: 'int', group: 'Период и порядок' },
    { name: 'categoryIds', label: 'Категории (для позиции «Страница категории»)', kind: 'intlist', hint: 'Баннер показывается и в подкатегориях', group: 'Категории' },
  ],
  news: [
    { name: 'title', label: 'Название', kind: 'text', required: true, maxLength: 200 },
    { name: 'excerpt', label: 'Краткое описание', kind: 'textarea', maxLength: 400 },
    { name: 'body', label: 'Содержимое', kind: 'textarea', maxLength: 50000 },
    { name: 'categoryId', label: 'Категория', kind: 'refselect', group: 'Публикация' },
    { name: 'authorStaffId', label: 'Автор — сотрудник', kind: 'refselect', group: 'Публикация' },
    { name: 'authorName', label: 'Автор — текстом', kind: 'text', maxLength: 100, hint: 'Используется, если сотрудник не выбран', group: 'Публикация' },
    { name: 'status', label: 'Статус', kind: 'select', options: STATUS_OPTIONS, group: 'Публикация' },
    { name: 'publishedAt', label: 'Дата и время публикации (МСК)', kind: 'datetime', hint: 'Пусто — момент публикации', group: 'Публикация' },
    ...seo(),
    ...indexing(),
    ...imageFields(),
  ],
  'news-categories': [
    { name: 'name', label: 'Название', kind: 'text', required: true, maxLength: 100 },
    { name: 'slug', label: 'Адрес (slug)', kind: 'text', maxLength: 100, hint: 'Пусто — по названию' },
    { name: 'sort', label: 'Порядок', kind: 'int' },
  ],
  services: [
    { name: 'title', label: 'Название', kind: 'text', required: true, maxLength: 200 },
    { name: 'summary', label: 'Краткое описание', kind: 'textarea', maxLength: 400 },
    { name: 'body', label: 'Описание', kind: 'textarea', maxLength: 50000 },
    { name: 'priceText', label: 'Стоимость (текстом)', kind: 'text', maxLength: 100, hint: 'Например «от …» или «по договорённости». Показывается, только если заполнено; цены не выдумываются' },
    { name: 'categoryId', label: 'Категория', kind: 'refselect' },
    { name: 'sort', label: 'Порядок', kind: 'int' },
    { name: 'published', label: 'Опубликована', kind: 'bool' },
    ...seo(),
    ...imageFields(),
  ],
  'service-categories': [
    { name: 'name', label: 'Название', kind: 'text', required: true, maxLength: 100 },
    { name: 'slug', label: 'Адрес (slug)', kind: 'text', maxLength: 100, hint: 'Пусто — по названию' },
    { name: 'sort', label: 'Порядок', kind: 'int' },
  ],
  promotions: [
    { name: 'title', label: 'Название', kind: 'text', required: true, maxLength: 200 },
    { name: 'summary', label: 'Краткое описание', kind: 'textarea', maxLength: 400 },
    { name: 'body', label: 'Описание акции', kind: 'textarea', maxLength: 50000 },
    { name: 'conditions', label: 'Условия акции', kind: 'textarea', maxLength: 2000, hint: 'Текст для покупателя' },
    { name: 'startsAt', label: 'Действует с', kind: 'date', group: 'Период и статус' },
    { name: 'endsAt', label: 'Действует по (включительно)', kind: 'date', endOfDay: true, group: 'Период и статус' },
    { name: 'published', label: 'Опубликована', kind: 'bool', group: 'Период и статус' },
    { name: 'sort', label: 'Порядок в списке', kind: 'int', group: 'Период и статус' },
    {
      name: 'discountType',
      label: 'Тип скидки',
      kind: 'select',
      options: [
        { value: 'none', label: 'Без скидки (только информирует)' },
        { value: 'percent', label: 'Процент' },
        { value: 'fixed', label: 'Сумма, ₽' },
      ],
      group: 'Скидка',
    },
    { name: 'discountValue', label: 'Размер скидки (% или ₽)', kind: 'text', hint: 'Процент — целое от 1 до 99; рубли — например 500 или 500,50', group: 'Скидка' },
    { name: 'minSubtotalKopecks', label: 'Минимальная сумма корзины, ₽', kind: 'money', hint: 'Сумма товаров до акций; пусто — без ограничения', group: 'Скидка' },
    { name: 'maxDiscountKopecks', label: 'Не больше, ₽ на единицу товара', kind: 'money', hint: 'Верхняя граница скидки; пусто — без границы', group: 'Скидка' },
    { name: 'priority', label: 'Приоритет', kind: 'int', hint: 'На товар действует одна акция — с большим приоритетом. Одинаковый приоритет у пересекающихся акций не допускается', group: 'Скидка' },
    { name: 'categoryIds', label: 'Категории акции (с подкатегориями)', kind: 'intlist', group: 'Участвуют' },
    { name: 'productIds', label: 'Товары акции', kind: 'intlist', group: 'Участвуют' },
    { name: 'promoCode', label: 'Промокод для показа', kind: 'text', maxLength: 32, hint: 'Сам купон заводится в разделе «Купоны»', group: 'Участвуют' },
    ...seo(),
    ...imageFields(),
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
