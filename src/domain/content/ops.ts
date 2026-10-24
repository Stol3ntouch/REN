import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { findPromotionConflict } from '@/domain/pricing/promotion-rules';
import { withTransaction } from '@/server/db/connection';
import { companyReviewsRepo, type CompanyReviewRow, type CompanyReviewWrite } from '@/server/db/repositories/company-reviews';
import { newsRepo, staffDisplayName, type NewsRow, type NewsWrite } from '@/server/db/repositories/news';
import { newsCategoriesRepo, type NewsCategoryRow, type NewsCategoryWrite } from '@/server/db/repositories/news-categories';
import { promotionsRepo, type PromotionRow, type PromotionWrite } from '@/server/db/repositories/promotions';
import { serviceCategoriesRepo, type ServiceCategoryRow, type ServiceCategoryWrite } from '@/server/db/repositories/service-categories';
import { servicesRepo, type ServiceRow, type ServiceWrite } from '@/server/db/repositories/services';
import { MAX_SLIDES, slidesRepo, type SlideRow, type SlideWrite } from '@/server/db/repositories/slides';
import { settingsRepo } from '@/server/db/repositories/settings';
import { formatRub } from '@/domain/pricing/format';
import { ValidationError } from '@/server/http/errors';
import { intakeImage } from './images';
import {
  authorize, copySlug, flag, image, int, link, makeOps, nul, opt, parse, required, resolve, resolveSlug, seoShape, stamp,
  type Ctx, type ImageInput, type Session,
} from './ops-core';
import { bannerOps } from './ops-banners';
import { pageOps } from './ops-pages';
import { visibilityOps } from './ops-visibility';
import { canonicalSchema, resolvePublication, statusSchema } from './publication';
import { HIDEABLE_SECTIONS, isSectionHidden, sectionSettingKey, type HideableSection } from './queries';
import { EDITABLE_SETTING_KEYS, type EditableSettingKey } from './settings';

export type { Ctx, ImageInput };

/**
 * Операции админки «Контент». Каждая сама проверяет право content.write (promos.write / reviews.moderate для купонов
 * и отзывов) — не полагаясь на обработчик, — валидирует вход (zod), пишет через репозиторий и фиксирует аудит.
 * Семантика save: значения полей из формы заменяют сохранённые; картинка — только если загружена новая или отмечено удаление.
 */

// ---------- новости ----------

const newsSchema = z.object({
  title: required(200, 'Укажите название'),
  ...seoShape,
  canonical: canonicalSchema,
  noindex: flag,
  excerpt: opt(400),
  body: opt(50000),
  published: flag,
  status: statusSchema,
  publishedAt: stamp,
  categoryId: z.number().int().min(1).nullable().optional(),
  authorStaffId: z.number().int().min(1).nullable().optional(),
  authorName: opt(100),
});

const news = makeOps<NewsRow, NewsWrite, z.infer<typeof newsSchema>>({
  entity: 'news',
  repo: newsRepo,
  schema: newsSchema,
  hasImage: true,
  validate: (i, _e, { db }) => {
    if (i.categoryId && !newsCategoriesRepo.get(db, i.categoryId)) throw new ValidationError('Категория новостей не найдена', { categoryId: ['Категория не найдена'] });
    if (i.authorStaffId && staffDisplayName(db, i.authorStaffId) === null) throw new ValidationError('Автор не найден среди сотрудников', { authorStaffId: ['Сотрудник не найден'] });
  },
  build: (i, existing, { db, now }) => {
    const pub = resolvePublication({ status: i.status, published: i.published, publishedAt: i.publishedAt }, existing ? { published: existing.published, publishedAt: existing.publishedAt } : null, now);
    const staffId = i.authorStaffId ?? null;
    return {
      slug: resolveSlug(newsRepo, db, i.slug, i.title, existing),
      title: i.title,
      h1: nul(i.h1),
      seoTitle: nul(i.seoTitle),
      seoDescription: nul(i.seoDescription),
      canonical: nul(i.canonical),
      noindex: i.noindex ?? existing?.noindex ?? false,
      excerpt: nul(i.excerpt),
      body: i.body ?? '',
      imageAlt: nul(i.imageAlt),
      published: pub.published,
      publishedAt: pub.publishedAt,
      categoryId: i.categoryId === undefined ? (existing?.categoryId ?? null) : i.categoryId,
      authorStaffId: staffId,
      authorName: staffId ? staffDisplayName(db, staffId) : nul(i.authorName),
    };
  },
  duplicate: (row, { db }) => ({
    slug: copySlug(newsRepo, db, row.slug),
    title: `${row.title} (копия)`.slice(0, 200),
    h1: row.h1,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    excerpt: row.excerpt,
    body: row.body,
    imagePath: row.imagePath,
    imageVariants: row.imageVariants,
    imageAlt: row.imageAlt,
    published: false,
    publishedAt: null,
    categoryId: row.categoryId,
    authorStaffId: row.authorStaffId,
    authorName: row.authorName,
  }),
});

// ---------- категории новостей и услуг ----------

const categorySchema = z.object({ name: required(100, 'Укажите название'), slug: opt(100), sort: int });

const newsCategories = makeOps<NewsCategoryRow, NewsCategoryWrite, z.infer<typeof categorySchema>>({
  entity: 'news_categories',
  repo: newsCategoriesRepo,
  schema: categorySchema,
  hasImage: false,
  build: (i, existing, { db }) => ({ slug: resolveSlug(newsCategoriesRepo, db, i.slug, i.name, existing), name: i.name, sort: i.sort ?? existing?.sort ?? 0 }),
});

const serviceCategories = makeOps<ServiceCategoryRow, ServiceCategoryWrite, z.infer<typeof categorySchema>>({
  entity: 'service_categories',
  repo: serviceCategoriesRepo,
  schema: categorySchema,
  hasImage: false,
  build: (i, existing, { db }) => ({ slug: resolveSlug(serviceCategoriesRepo, db, i.slug, i.name, existing), name: i.name, sort: i.sort ?? existing?.sort ?? 0 }),
});

// ---------- услуги ----------

const serviceSchema = z.object({
  title: required(200, 'Укажите название'),
  ...seoShape,
  summary: opt(400),
  body: opt(50000),
  priceText: opt(100),
  categoryId: z.number().int().min(1).nullable().optional(),
  published: flag,
  sort: int,
});

const services = makeOps<ServiceRow, ServiceWrite, z.infer<typeof serviceSchema>>({
  entity: 'services',
  repo: servicesRepo,
  schema: serviceSchema,
  hasImage: true,
  validate: (i, _e, { db }) => {
    if (i.categoryId && !serviceCategoriesRepo.get(db, i.categoryId)) throw new ValidationError('Категория услуг не найдена', { categoryId: ['Категория не найдена'] });
  },
  build: (i, existing, { db }) => ({
    slug: resolveSlug(servicesRepo, db, i.slug, i.title, existing),
    title: i.title,
    h1: nul(i.h1),
    seoTitle: nul(i.seoTitle),
    seoDescription: nul(i.seoDescription),
    summary: nul(i.summary),
    body: i.body ?? '',
    priceText: nul(i.priceText),
    imageAlt: nul(i.imageAlt),
    categoryId: i.categoryId === undefined ? (existing?.categoryId ?? null) : i.categoryId,
    published: i.published ?? false,
    sort: i.sort ?? 0,
  }),
  duplicate: (row, { db }) => ({
    slug: copySlug(servicesRepo, db, row.slug),
    title: `${row.title} (копия)`.slice(0, 200),
    h1: row.h1,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    summary: row.summary,
    body: row.body,
    priceText: row.priceText,
    imagePath: row.imagePath,
    imageVariants: row.imageVariants,
    imageAlt: row.imageAlt,
    categoryId: row.categoryId,
    published: false,
    sort: row.sort + 1,
  }),
});

// ---------- акции ----------

const promotionSchema = z
  .object({
    title: required(200, 'Укажите название'),
    ...seoShape,
    summary: opt(400),
    body: opt(50000),
    conditions: opt(2000),
    promoCode: z
      .string()
      .trim()
      .max(32, 'Не длиннее 32 символов')
      .regex(/^[A-Za-z0-9А-Яа-я_-]*$/, 'Промокод — буквы, цифры, «-» и «_»')
      .optional(),
    startsAt: stamp,
    endsAt: stamp,
    published: flag,
    sort: int,
    discountType: z.enum(['percent', 'fixed', 'none'], { error: 'Неизвестный тип скидки' }).optional(),
    /** percent: 1–99; fixed: копейки. */
    discountValue: z.number().int('Нужно целое число').min(0).optional(),
    minSubtotalKopecks: z.number().int().min(0, 'Не меньше нуля').nullable().optional(),
    maxDiscountKopecks: z.number().int().min(1, 'Не меньше копейки').nullable().optional(),
    priority: z.number().int().min(-1000).max(1000).nullable().optional(),
    productIds: z.array(z.number().int().min(1)).max(500).optional(),
    categoryIds: z.array(z.number().int().min(1)).max(200).optional(),
  })
  .refine((v) => v.startsAt == null || v.endsAt == null || v.endsAt >= v.startsAt, { message: 'Дата окончания раньше даты начала', path: ['endsAt'] });

type PromotionInput = z.infer<typeof promotionSchema>;

const fail = (field: string, message: string): never => {
  throw new ValidationError(message, { [field]: [message] });
};

/** Итоговые правила скидки акции с учётом прежних значений при частичном вводе. */
function promotionRules(i: PromotionInput, e: PromotionRow | null) {
  const discountType = i.discountType ?? e?.discountType ?? 'none';
  const discountValue = discountType === 'none' ? 0 : (i.discountValue ?? e?.discountValue ?? 0);
  return {
    discountType,
    discountValue,
    minSubtotalKopecks: i.minSubtotalKopecks === null ? 0 : (i.minSubtotalKopecks ?? e?.minSubtotalKopecks ?? 0),
    maxDiscountKopecks: i.maxDiscountKopecks === undefined ? (e?.maxDiscountKopecks ?? null) : i.maxDiscountKopecks,
    priority: i.priority === null ? 0 : (i.priority ?? e?.priority ?? 0),
    published: i.published ?? e?.published ?? false,
    startsAt: i.startsAt === undefined ? (e?.startsAt ?? null) : i.startsAt,
    endsAt: i.endsAt === undefined ? (e?.endsAt ?? null) : i.endsAt,
  };
}

const promotions = makeOps<PromotionRow, PromotionWrite, PromotionInput>({
  entity: 'promotions',
  repo: promotionsRepo,
  schema: promotionSchema,
  hasImage: true,
  validate: (i, existing, { db }) => {
    const r = promotionRules(i, existing);
    const targets = {
      productIds: i.productIds ?? (existing ? promotionsRepo.targets(db, existing.id).productIds : []),
      categoryIds: i.categoryIds ?? (existing ? promotionsRepo.targets(db, existing.id).categoryIds : []),
    };
    if (i.productIds && promotionsRepo.existingProductIds(db, i.productIds).size !== new Set(i.productIds).size) fail('productIds', 'Один из выбранных товаров не найден');
    if (i.categoryIds && promotionsRepo.existingCategoryIds(db, i.categoryIds).size !== new Set(i.categoryIds).size) fail('categoryIds', 'Одна из выбранных категорий не найдена');
    if (r.discountType === 'none') return;

    if (r.discountType === 'percent' && (r.discountValue < 1 || r.discountValue > 99)) fail('discountValue', 'Процент скидки — от 1 до 99: цена не может стать нулевой');
    if (r.discountType === 'fixed' && r.discountValue < 1) fail('discountValue', 'Скидка в рублях должна быть больше нуля');
    if (targets.productIds.length === 0 && targets.categoryIds.length === 0) fail('productIds', 'Скидка применяется к товарам: выберите товары или категории акции');
    if (r.discountType === 'fixed') {
      const min = promotionsRepo.minPrice(db, targets);
      if (min !== null && r.discountValue >= min) fail('discountValue', `Скидка ${formatRub(r.discountValue)} не меньше цены самого дешёвого товара акции (${formatRub(min)}): цена стала бы нулевой`);
    }
    if (r.published) {
      const conflict = findPromotionConflict(db, { id: existing?.id ?? null, discountType: r.discountType, priority: r.priority, startsAt: r.startsAt, endsAt: r.endsAt, targets });
      if (conflict) {
        fail('priority', `На товар «${conflict.productName}» в те же даты уже действует акция «${conflict.promotionTitle}» с таким же приоритетом. Задайте разный приоритет: применится акция с большим.`);
      }
    }
  },
  build: (i, existing, { db }) => {
    const r = promotionRules(i, existing);
    return {
      slug: resolveSlug(promotionsRepo, db, i.slug, i.title, existing),
      title: i.title,
      h1: nul(i.h1),
      seoTitle: nul(i.seoTitle),
      seoDescription: nul(i.seoDescription),
      summary: nul(i.summary),
      body: i.body ?? '',
      conditions: nul(i.conditions),
      imageAlt: nul(i.imageAlt),
      promoCode: nul(i.promoCode),
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      published: r.published,
      sort: i.sort ?? 0,
      discountType: r.discountType,
      discountValue: r.discountValue,
      minSubtotalKopecks: r.minSubtotalKopecks,
      maxDiscountKopecks: r.maxDiscountKopecks,
      priority: r.priority,
      ...(existing ? {} : { createdAt: Date.now() }),
    };
  },
  afterSave: (id, i, existing, { db }) => {
    if (i.productIds === undefined && i.categoryIds === undefined) return;
    const current = existing ? promotionsRepo.targets(db, id) : { productIds: [], categoryIds: [] };
    promotionsRepo.replaceTargets(db, id, { productIds: [...new Set(i.productIds ?? current.productIds)], categoryIds: [...new Set(i.categoryIds ?? current.categoryIds)] });
  },
  afterDuplicate: (newId, sourceId, { db }) => promotionsRepo.replaceTargets(db, newId, promotionsRepo.targets(db, sourceId)),
  duplicate: (row, { db }) => ({
    slug: copySlug(promotionsRepo, db, row.slug),
    title: `${row.title} (копия)`.slice(0, 200),
    h1: row.h1,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    summary: row.summary,
    body: row.body,
    conditions: row.conditions,
    imagePath: row.imagePath,
    imageVariants: row.imageVariants,
    imageAlt: row.imageAlt,
    promoCode: null,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    published: false,
    sort: row.sort + 1,
    discountType: row.discountType,
    discountValue: row.discountValue,
    minSubtotalKopecks: row.minSubtotalKopecks,
    maxDiscountKopecks: row.maxDiscountKopecks,
    priority: row.priority,
    createdAt: Date.now(),
  }),
});

// ---------- слайды ----------

const slideSchema = z.object({
  title: required(120, 'Укажите заголовок'),
  subtitle: opt(300),
  linkUrl: link,
  linkLabel: opt(60),
  imageAlt: opt(200),
  image,
  active: flag,
  sort: int,
});

const slides = makeOps<SlideRow, SlideWrite, z.infer<typeof slideSchema>>({
  entity: 'slides',
  repo: { ...slidesRepo, slugTaken: () => false },
  schema: slideSchema,
  hasImage: true,
  beforeInsert: (db) => {
    if (slidesRepo.count(db) >= MAX_SLIDES) throw new ValidationError(`В слайдере не больше ${MAX_SLIDES} слайдов. Удалите или измените существующий.`);
  },
  build: (i) => ({
    title: i.title,
    subtitle: nul(i.subtitle),
    linkUrl: nul(i.linkUrl),
    linkLabel: nul(i.linkLabel),
    imageAlt: nul(i.imageAlt),
    active: i.active ?? false,
    sort: i.sort ?? 0,
  }),
});

// ---------- отзывы о компании ----------

const reviewSchema = z.object({
  authorName: required(100, 'Укажите имя автора'),
  body: required(2000, 'Введите текст отзыва'),
  rating: z.number().int().min(1, 'Оценка — от 1 до 5').max(5, 'Оценка — от 1 до 5').nullable().optional(),
  reviewedAt: stamp,
  published: flag,
  sort: int,
  image: image,
});

const reviews = makeOps<CompanyReviewRow, CompanyReviewWrite, z.infer<typeof reviewSchema>>({
  entity: 'reviews',
  repo: { ...companyReviewsRepo, slugTaken: () => false },
  schema: reviewSchema,
  hasImage: false,
  build: (i) => ({
    authorName: i.authorName,
    body: i.body,
    rating: i.rating ?? null,
    reviewedAt: i.reviewedAt ?? null,
    published: i.published ?? false,
    sort: i.sort ?? 0,
  }),
});


const pages = pageOps;

// ---------- разделы целиком (новости, акции, услуги) ----------

const sections = {
  /**
   * Скрыть (hidden=true) или показать раздел целиком: список, страницы записей, меню, подвал, sitemap и блок на главной.
   * Записи не меняются и не удаляются. Хранится в shop_settings (section_hidden_<раздел>). Право content.write; аудит section.visibility.
   */
  async setHidden(session: Session, section: unknown, hidden: unknown, ctx: Ctx = {}): Promise<{ changed: boolean }> {
    authorize(session);
    const name: HideableSection = parse(z.enum(HIDEABLE_SECTIONS, { error: 'Такой раздел скрыть нельзя' }), section);
    const flag = parse(z.boolean({ error: 'Неверное действие' }), hidden);
    const { db, now } = resolve(ctx);
    return withTransaction(db, () => {
      if (isSectionHidden(name, { db }) === flag) return { changed: false };
      if (flag) settingsRepo.set(db, sectionSettingKey(name), '1', now);
      else settingsRepo.delete(db, sectionSettingKey(name));
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'section.visibility', entity: 'content_section', entityId: name, before: { hidden: !flag }, after: { hidden: flag } },
        { db, now },
      );
      return { changed: true };
    });
  },
};

// ---------- настройки магазина ----------

const urlOk = (v: string) => /^https?:\/\/\S+$/i.test(v);
const SETTING_RULES: Partial<Record<EditableSettingKey, (v: string) => string | null>> = {
  phone: (v) => (/\d{5,}/.test(v.replace(/\D/g, '')) ? null : 'В телефоне должно быть не меньше пяти цифр'),
  email: (v) => (z.email().safeParse(v).success ? null : 'Неверный адрес электронной почты'),
  latitude: (v) => (Number.isFinite(Number(v.replace(',', '.'))) && Math.abs(Number(v.replace(',', '.'))) <= 90 ? null : 'Широта — число от −90 до 90'),
  longitude: (v) => (Number.isFinite(Number(v.replace(',', '.'))) && Math.abs(Number(v.replace(',', '.'))) <= 180 ? null : 'Долгота — число от −180 до 180'),
  social_vk: (v) => (urlOk(v) ? null : 'Ссылка должна начинаться с https://'),
  social_telegram: (v) => (urlOk(v) ? null : 'Ссылка должна начинаться с https://'),
  social_whatsapp: (v) => (urlOk(v) ? null : 'Ссылка должна начинаться с https://'),
  social_youtube: (v) => (urlOk(v) ? null : 'Ссылка должна начинаться с https://'),
};
const SETTING_MAX: Partial<Record<EditableSettingKey, number>> = {
  phone: 40, address: 300, email: 200, latitude: 20, longitude: 20, requisites: 2000, delivery_payment_text: 3000,
  home_h1: 200, home_title: 200, home_description: 400, social_vk: 300, social_telegram: 300, social_whatsapp: 300, social_youtube: 300,
};

export type SettingsInput = Partial<Record<EditableSettingKey, string>> & { logo?: ImageInput };

const settings = {
  async save(session: Session, values: SettingsInput, ctx: Ctx = {}): Promise<{ changed: string[] }> {
    authorize(session);
    const { db, now, uploadsDir } = resolve(ctx);
    const before = settingsRepo.all(db);
    const next: Record<string, string> = {};
    const errors: Record<string, string[]> = {};

    for (const key of EDITABLE_SETTING_KEYS) {
      const raw = values[key];
      if (raw === undefined) continue;
      const v = raw.trim();
      const max = SETTING_MAX[key] ?? 300;
      if (v.length > max) errors[key] = [`Не длиннее ${max} символов`];
      else if (v !== '' && SETTING_RULES[key]?.(v)) errors[key] = [SETTING_RULES[key]!(v) as string];
      else next[key] = v;
    }
    if (Object.keys(errors).length > 0) throw new ValidationError(Object.values(errors)[0]![0], errors);

    const finalValue = (key: EditableSettingKey) => (key in next ? next[key] : before[key]) ?? '';
    if ((finalValue('latitude') === '') !== (finalValue('longitude') === '')) {
      throw new ValidationError('Координаты задаются парой: заполните и широту, и долготу (или очистите обе)', {
        latitude: ['Заполните широту и долготу вместе'],
      });
    }

    let logoPath: string | null | undefined;
    if (values.logo?.bytes && values.logo.bytes.byteLength > 0) {
      const stored = await intakeImage(values.logo.bytes, uploadsDir);
      const variants = JSON.parse(stored.imageVariants) as { key: string; path: string }[];
      logoPath = (variants.find((v) => v.key === 'card') ?? variants.at(-1))?.path ?? stored.imagePath;
    } else if (values.logo?.remove) {
      logoPath = null;
    }

    const changed: string[] = [];
    withTransaction(db, () => {
      for (const [key, v] of Object.entries(next)) {
        if ((before[key] ?? '') === v) continue;
        if (v === '') settingsRepo.delete(db, key);
        else settingsRepo.set(db, key, v, now);
        changed.push(key);
      }
      if (logoPath !== undefined) {
        if (logoPath === null) settingsRepo.delete(db, 'logo_path');
        else settingsRepo.set(db, 'logo_path', logoPath, now);
        changed.push('logo_path');
      }
    });

    if (changed.length > 0) {
      const after = settingsRepo.all(db);
      audit.record(
        {
          actorId: session.staffId,
          actorType: 'staff',
          action: 'content.settings.update',
          entity: 'shop_settings',
          before: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
          after: Object.fromEntries(changed.map((k) => [k, after[k] ?? null])),
        },
        { db, now },
      );
    }
    return { changed };
  },
};


export const contentOps = { settings, pages, sections, slides, banners: bannerOps, news, newsCategories, services, serviceCategories, promotions, reviews, visibility: visibilityOps };
