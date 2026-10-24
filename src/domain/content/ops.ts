import { z } from 'zod';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { audit } from '@/domain/admin/audit';
import { slugify } from '@/importing/yml/slug';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { companyReviewsRepo, type CompanyReviewRow, type CompanyReviewWrite } from '@/server/db/repositories/company-reviews';
import { newsRepo, type NewsRow, type NewsWrite } from '@/server/db/repositories/news';
import { pagesRepo, type PageRow, type PageWrite } from '@/server/db/repositories/pages';
import { promotionsRepo, type PromotionRow, type PromotionWrite } from '@/server/db/repositories/promotions';
import { servicesRepo, type ServiceRow, type ServiceWrite } from '@/server/db/repositories/services';
import { MAX_SLIDES, slidesRepo, type SlideRow, type SlideWrite } from '@/server/db/repositories/slides';
import { settingsRepo } from '@/server/db/repositories/settings';
import { NotFoundError, ValidationError } from '@/server/http/errors';
import { intakeImage, type ImageInput } from './images';
import { EDITABLE_SETTING_KEYS, type EditableSettingKey } from './settings';

/**
 * Операции админки «Контент и услуги». Каждая сама проверяет право content.write (только admin) —
 * не полагаясь на обработчик, — валидирует вход (zod), пишет через репозиторий и фиксирует аудит.
 * Семантика save: значения полей из формы заменяют сохранённые; картинка — только если загружена новая или отмечено удаление.
 */
export type Ctx = { db?: Db; now?: number; uploadsDir?: string };
export type { ImageInput };
type Session = StaffSession | null | undefined;
type Resolved = { db: Db; now: number; uploadsDir?: string };

const resolve = (ctx: Ctx): Resolved => ({ db: ctx.db ?? getDb(), now: ctx.now ?? Date.now(), uploadsDir: ctx.uploadsDir });

function authorize(session: Session): asserts session is StaffSession {
  requirePermission(session, 'content.write');
}

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  const fields: Record<string, string[]> = {};
  for (const issue of r.error.issues) {
    const key = String(issue.path[0] ?? '_');
    (fields[key] ??= []).push(issue.message);
  }
  throw new ValidationError(r.error.issues[0]?.message ?? 'Проверьте введённые данные', fields);
}

// ---------- общие куски схем ----------

const opt = (max: number) => z.string().trim().max(max, `Не длиннее ${max} символов`).optional();
const required = (max: number, msg: string) => z.string().trim().min(1, msg).max(max, `Не длиннее ${max} символов`);
const image = z.custom<ImageInput>((v) => v === undefined || (typeof v === 'object' && v !== null)).optional();
const flag = z.boolean().optional();
const int = z.number().int('Нужно целое число').nullable().optional();
const stamp = z.number().int().nullable().optional();
const nul = (v: string | undefined): string | null => (v === undefined || v.trim() === '' ? null : v.trim());

const seoShape = {
  slug: opt(100),
  h1: opt(200),
  seoTitle: opt(200),
  seoDescription: opt(400),
  imageAlt: opt(200),
  image,
};

function resolveSlug(repo: SlugRepo, db: Db, wanted: string | undefined, title: string, existing: { id: number; slug: string } | null): string {
  const explicit = nul(wanted);
  const base = slugify(explicit ?? existing?.slug ?? title);
  if (base === '') throw new ValidationError('Адрес (slug) должен содержать буквы или цифры', { slug: ['Адрес (slug) должен содержать буквы или цифры'] });
  if (!repo.slugTaken(db, base, existing?.id)) return base;
  if (explicit !== null || existing) throw new ValidationError('Такой адрес (slug) уже занят', { slug: ['Такой адрес (slug) уже занят'] });
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!repo.slugTaken(db, candidate)) return candidate;
  }
  throw new ValidationError('Не удалось подобрать свободный адрес (slug)');
}

type SlugRepo = { slugTaken(db: Db, slug: string, exceptId?: number): boolean };
type Repo<Row, Write> = SlugRepo & {
  get(db: Db, id: number): Row | null;
  insert(db: Db, data: Write, now: number): number;
  update(db: Db, id: number, data: Write, now: number): void;
  remove(db: Db, id: number): void;
};

/** Для аудита: без длинных текстов (они остаются в самой записи). */
function auditView(row: unknown): unknown {
  if (!row || typeof row !== 'object') return row;
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}…` : v]));
}

type EntityConfig<Row extends { id: number }, Write extends object, In extends { image?: ImageInput }> = {
  entity: string;
  repo: Repo<Row, Write>;
  schema: z.ZodType<In>;
  hasImage: boolean;
  /** Проверки перед созданием (лимиты). */
  beforeInsert?(db: Db): void;
  build(input: In, existing: Row | null, env: { db: Db; now: number }): Write;
};

function makeOps<Row extends { id: number }, Write extends object, In extends { image?: ImageInput }>(cfg: EntityConfig<Row, Write, In>) {
  return {
    async save(session: Session, id: number | null, raw: In, ctx: Ctx = {}): Promise<{ id: number }> {
      authorize(session);
      const { db, now, uploadsDir } = resolve(ctx);
      const input = parse(cfg.schema, raw);
      const existing = id === null ? null : cfg.repo.get(db, id);
      if (id !== null && !existing) throw new NotFoundError('Запись не найдена');
      if (!existing) cfg.beforeInsert?.(db);

      const write: Record<string, unknown> = { ...(cfg.build(input, existing, { db, now }) as Record<string, unknown>) };
      if (cfg.hasImage) {
        if (input.image?.bytes && input.image.bytes.byteLength > 0) {
          const stored = await intakeImage(input.image.bytes, uploadsDir);
          write.imagePath = stored.imagePath;
          write.imageVariants = stored.imageVariants;
        } else if (input.image?.remove) {
          write.imagePath = null;
          write.imageVariants = null;
        }
      }

      let savedId: number;
      try {
        savedId = withTransaction(db, () => {
          if (existing) {
            cfg.repo.update(db, existing.id, write as Write, now);
            return existing.id;
          }
          return cfg.repo.insert(db, write as Write, now);
        });
      } catch (e) {
        if (e instanceof Error && e.message.includes('slides_limit')) throw new ValidationError(`В слайдере не больше ${MAX_SLIDES} слайдов`);
        throw e;
      }
      audit.record(
        {
          actorId: session.staffId,
          actorType: 'staff',
          action: `content.${cfg.entity}.${existing ? 'update' : 'create'}`,
          entity: `content_${cfg.entity}`,
          entityId: savedId,
          before: existing ? auditView(existing) : undefined,
          after: auditView(cfg.repo.get(db, savedId)),
        },
        { db, now },
      );
      return { id: savedId };
    },

    async remove(session: Session, id: number, ctx: Ctx = {}): Promise<void> {
      authorize(session);
      const { db, now } = resolve(ctx);
      const existing = cfg.repo.get(db, id);
      if (!existing) throw new NotFoundError('Запись не найдена');
      cfg.repo.remove(db, id);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: `content.${cfg.entity}.delete`, entity: `content_${cfg.entity}`, entityId: id, before: auditView(existing) },
        { db, now },
      );
    },
  };
}

// ---------- новости ----------

const newsSchema = z.object({
  title: required(200, 'Укажите название'),
  ...seoShape,
  excerpt: opt(400),
  body: opt(50000),
  published: flag,
  publishedAt: stamp,
});

const news = makeOps<NewsRow, NewsWrite, z.infer<typeof newsSchema>>({
  entity: 'news',
  repo: newsRepo,
  schema: newsSchema,
  hasImage: true,
  build: (i, existing, { db, now }) => ({
    slug: resolveSlug(newsRepo, db, i.slug, i.title, existing),
    title: i.title,
    h1: nul(i.h1),
    seoTitle: nul(i.seoTitle),
    seoDescription: nul(i.seoDescription),
    excerpt: nul(i.excerpt),
    body: i.body ?? '',
    imageAlt: nul(i.imageAlt),
    published: i.published ?? false,
    publishedAt: i.publishedAt ?? existing?.publishedAt ?? (i.published ? now : null),
  }),
});

// ---------- услуги ----------

const serviceSchema = z.object({
  title: required(200, 'Укажите название'),
  ...seoShape,
  summary: opt(400),
  body: opt(50000),
  priceText: opt(100),
  published: flag,
  sort: int,
});

const services = makeOps<ServiceRow, ServiceWrite, z.infer<typeof serviceSchema>>({
  entity: 'services',
  repo: servicesRepo,
  schema: serviceSchema,
  hasImage: true,
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
    published: i.published ?? false,
    sort: i.sort ?? 0,
  }),
});

// ---------- акции ----------

const promotionSchema = z
  .object({
    title: required(200, 'Укажите название'),
    ...seoShape,
    summary: opt(400),
    body: opt(50000),
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
  })
  .refine((v) => v.startsAt == null || v.endsAt == null || v.endsAt >= v.startsAt, { message: 'Дата окончания раньше даты начала', path: ['endsAt'] });

const promotions = makeOps<PromotionRow, PromotionWrite, z.infer<typeof promotionSchema>>({
  entity: 'promotions',
  repo: promotionsRepo,
  schema: promotionSchema,
  hasImage: true,
  build: (i, existing, { db }) => ({
    slug: resolveSlug(promotionsRepo, db, i.slug, i.title, existing),
    title: i.title,
    h1: nul(i.h1),
    seoTitle: nul(i.seoTitle),
    seoDescription: nul(i.seoDescription),
    summary: nul(i.summary),
    body: i.body ?? '',
    imageAlt: nul(i.imageAlt),
    promoCode: nul(i.promoCode),
    startsAt: i.startsAt ?? null,
    endsAt: i.endsAt ?? null,
    published: i.published ?? false,
    sort: i.sort ?? 0,
  }),
});

// ---------- слайды ----------

const link = z
  .string()
  .trim()
  .max(300, 'Не длиннее 300 символов')
  .refine((v) => v === '' || (v.startsWith('/') && !v.startsWith('//')) || /^https?:\/\/\S+$/i.test(v), 'Ссылка — путь на сайте (/catalog) или адрес https://…')
  .optional();

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

// ---------- страницы (правка существующих; системные страницы не создаются и не удаляются) ----------

const pageSchema = z.object({
  title: required(200, 'Укажите название'),
  slug: required(100, 'Укажите адрес (slug)'),
  h1: opt(200),
  seoTitle: opt(200),
  seoDescription: opt(400),
  body: opt(50000),
  legalDraft: flag,
});

const pageOps = makeOps<PageRow, PageWrite, z.infer<typeof pageSchema> & { image?: ImageInput }>({
  entity: 'pages',
  repo: pagesRepo,
  schema: pageSchema as z.ZodType<z.infer<typeof pageSchema> & { image?: ImageInput }>,
  hasImage: false,
  build: (i, existing, { db }) => ({
    slug: resolveSlug(pagesRepo, db, i.slug, i.title, existing),
    title: i.title,
    h1: nul(i.h1),
    seoTitle: nul(i.seoTitle),
    seoDescription: nul(i.seoDescription),
    body: i.body ?? '',
    legalDraft: i.legalDraft ?? false,
  }),
});

const pages = {
  async save(session: Session, id: number | null, raw: z.infer<typeof pageSchema>, ctx: Ctx = {}): Promise<{ id: number }> {
    authorize(session);
    if (id === null) throw new ValidationError('Системные страницы создать нельзя — отредактируйте существующую');
    return pageOps.save(session, id, raw, ctx);
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

export const contentOps = { settings, pages, slides, news, services, promotions, reviews };
