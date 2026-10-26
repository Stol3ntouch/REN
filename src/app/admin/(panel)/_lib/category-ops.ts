import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { clearCategoryImageCache } from '@/domain/catalog/category-images';
import { SLUG_PATTERN } from '@/domain/catalog/brands';
import { toCatalogImage } from '@/domain/catalog/images';
import { zodToValidation, isHttpUrl } from '@/domain/catalog/validation';
import { slugify } from '@/importing/yml/slug';
import { ImageStoreError, storeImage } from '@/media/store-image';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { categoriesRepo, type CardPatch, type CategoryRow } from '@/server/db/repositories/categories';
import { categoryLinksRepo, type BannerChoice, type BannerLinkRow, type RelatedRow } from '@/server/db/repositories/category-links';
import { facetsConfigRepo } from '@/server/db/repositories/facets-config';
import { parseVariants } from '@/server/db/repositories/images';
import { ConflictError, NotFoundError, ValidationError } from '@/server/http/errors';
import { liveCounts, subtreeOf } from './category-tree-ops';

type Opts = { db?: Db; now?: number };

/** Изображение категории: новый файл (байты), удалить или не менять. */
export type ImageChange = { bytes: Uint8Array } | { remove: true } | undefined;
export const CATEGORY_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const optional = (max: number, label: string) =>
  z
    .string({ error: `${label}: нужен текст` })
    .trim()
    .max(max, `${label}: не длиннее ${max} символов`)
    .transform((v) => (v === '' ? null : v));
const flag = (label: string) => z.boolean({ error: `${label}: да или нет` });
const int = (label: string, min: number, max: number) =>
  z.number({ error: `${label}: целое число` }).int(`${label}: целое число`).min(min, `${label}: от ${min}`).max(max, `${label}: до ${max}`);
const idSchema = z.number({ error: 'Категория не найдена' }).int('Категория не найдена').min(1, 'Категория не найдена');
const slugField = z
  .string({ error: 'Slug: нужен текст' })
  .trim()
  .toLowerCase()
  .max(100, 'Slug: не длиннее 100 символов')
  .refine((v) => v === '' || SLUG_PATTERN.test(v), 'Slug: только латиница, цифры и дефисы');

const createSchema = z
  .object({
    name: z.string({ error: 'Укажите название' }).trim().min(1, 'Укажите название').max(120, 'Название: не длиннее 120 символов'),
    parentId: idSchema.nullable(),
    slug: slugField.default(''),
  })
  .strict();

const headerSchema = z
  .object({
    name: z.string({ error: 'Укажите название' }).trim().min(1, 'Укажите название').max(120, 'Название: не длиннее 120 символов'),
    slug: slugField,
    description: optional(5000, 'Описание'),
    active: flag('Активная'),
    sort: int('Позиция', -100000, 100000),
    parentId: idSchema.nullable(),
  })
  .strict();

const extraSchema = z
  .object({
    showInMenu: flag('Показывать в меню'),
    showOnHome: flag('Показывать на главной'),
    showInCatalog: flag('Показывать в каталоге'),
    sort: int('Позиция сортировки', -100000, 100000),
    priority: int('Приоритет', -100000, 100000),
    code: z
      .string({ error: 'Код: нужен текст' })
      .trim()
      .max(64, 'Код: не длиннее 64 символов')
      .refine((v) => v === '' || /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(v), 'Код: латиница, цифры, «_», «-» и «.»'),
    externalRef: optional(100, 'Внешний ID'),
    adminComment: optional(2000, 'Комментарий администратора'),
    relatedIds: z.array(idSchema, { error: 'Связанные категории: неверный список' }).max(50, 'Связанных категорий не больше 50'),
  })
  .strict();

const seoSchema = z
  .object({
    seoTitle: optional(200, 'Title'),
    seoDescription: optional(500, 'Description'),
    h1: optional(200, 'H1'),
    seoText: optional(5000, 'SEO-текст'),
    slug: slugField,
    canonical: optional(500, 'Canonical').refine((v) => v === null || isHttpUrl(v) || (v.startsWith('/') && !v.startsWith('//')), 'Canonical: полный адрес http(s):// или путь, начинающийся с «/»'),
    indexable: flag('Индексация'),
  })
  .strict();

const filtersSchema = z
  .array(
    z
      .object({
        filterId: idSchema,
        enabled: flag('Показ фильтра'),
        sort: int('Порядок', -100000, 100000).nullable(),
      })
      .strict(),
    { error: 'Фильтры: неверный список' },
  )
  .max(500, 'Слишком много фильтров');

export type CategoryCreateInput = z.input<typeof createSchema>;
export type CategoryHeaderInput = z.input<typeof headerSchema>;
export type CategoryExtraInput = z.input<typeof extraSchema>;
export type CategorySeoFullInput = z.input<typeof seoSchema>;
export type CategoryFilterInput = z.input<typeof filtersSchema>;

function parse<T>(schema: z.ZodType<T, unknown>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw zodToValidation(r.error);
  return r.data;
}

const diffOf = <T extends Record<string, unknown>>(before: T, after: T) => {
  const keys = (Object.keys(after) as (keyof T)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  return { keys, before: Object.fromEntries(keys.map((k) => [k, before[k]])), after: Object.fromEntries(keys.map((k) => [k, after[k]])) };
};

const headerSnapshot = (c: CategoryRow) => ({ name: c.name, slug: c.slug, description: c.description, active: c.active, sort: c.sort, parentId: c.parentId, image: c.imagePath });

function freeSlug(base: string, taken: ReadonlySet<string>): string {
  const root = base || 'category';
  if (!taken.has(root)) return root;
  for (let n = 2; ; n++) if (!taken.has(`${root}-${n}`)) return `${root}-${n}`;
}

async function intakeImage(bytes: Uint8Array): Promise<{ imagePath: string; imageVariants: string }> {
  if (bytes.byteLength === 0) throw new ValidationError('Изображение: файл пустой', { image: ['Файл пустой'] });
  if (bytes.byteLength > CATEGORY_IMAGE_MAX_BYTES) throw new ValidationError('Изображение: файл больше 5 МБ', { image: ['Файл больше 5 МБ'] });
  try {
    const stored = await storeImage(bytes);
    return { imagePath: stored.path, imageVariants: JSON.stringify(stored.variants) };
  } catch (e) {
    if (e instanceof ImageStoreError) throw new ValidationError(`Изображение: ${e.message}`, { image: [e.message] });
    throw e;
  }
}

export type CategoryCard = {
  row: CategoryRow;
  /** Путь от корня до категории (включительно). */
  path: { id: number; name: string }[];
  childCount: number;
  /** Товары категории напрямую (любые, включая неопубликованные) и живые товары поддерева (как счётчик в дереве). */
  productCount: number;
  liveProductCount: number;
  imageUrl: string | null;
  related: RelatedRow[];
};

export type ParentOption = { id: number; label: string };

export type CategoryFilterRow = {
  filterId: number;
  label: string;
  kind: string;
  /** Общий порядок из «Фильтры каталога». */
  globalSort: number;
  enabled: boolean;
  sort: number | null;
  /** Фильтр спрятан настройкой предка (и не переопределён здесь). */
  inheritedOff: boolean;
};

/**
 * Карточка категории CMS (G20–G24): создание, правка, показ, связи, фильтры, баннеры, удаление.
 * Чтение — catalog.read, запись — categories.write. Каждое изменение — в журнал (category.*).
 * Видимость (глаз) — отдельно: categoryVisibilityOps. Слаг — адрес /catalog/<slug>; импорт YML slug не меняет.
 */
export const categoryOps = {
  get(session: StaffSession | null, id: number, opts: Opts = {}): CategoryCard | null {
    requirePermission(session, 'catalog.read');
    const db = opts.db ?? getDb();
    const rows = categoriesRepo.listAll(db);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const row = byId.get(id);
    if (!row) return null;
    const path: { id: number; name: string }[] = [];
    const seen = new Set<number>();
    for (let cur: CategoryRow | undefined = row; cur && !seen.has(cur.id); cur = cur.parentId === null ? undefined : byId.get(cur.parentId)) {
      seen.add(cur.id);
      path.unshift({ id: cur.id, name: cur.name });
    }
    const counts = liveCounts(db, rows).byCategory;
    return {
      row,
      path,
      childCount: rows.filter((r) => r.parentId === id).length,
      productCount: categoriesRepo.directProductCount(db, id),
      liveProductCount: counts.get(id) ?? 0,
      imageUrl: row.imagePath ? toCatalogImage({ path: row.imagePath, variants: parseVariants(row.imageVariants), urlSource: '', alt: null }, 'card', row.name).src : null,
      related: categoryLinksRepo.listRelated(db, id),
    };
  },

  /** Родительские категории для выбора: без самой категории и её потомков, с путём в подписи. */
  parentOptions(session: StaffSession | null, excludeId: number | null, opts: Opts = {}): ParentOption[] {
    requirePermission(session, 'catalog.read');
    const rows = categoriesRepo.listAll(opts.db ?? getDb());
    const banned = excludeId === null ? new Set<number>() : subtreeOf(rows, excludeId);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const label = (r: CategoryRow): string => {
      const names: string[] = [];
      const seen = new Set<number>();
      for (let cur: CategoryRow | undefined = r; cur && !seen.has(cur.id); cur = cur.parentId === null ? undefined : byId.get(cur.parentId)) {
        seen.add(cur.id);
        names.unshift(cur.name);
      }
      return names.join(' › ');
    };
    return rows.filter((r) => !banned.has(r.id)).map((r) => ({ id: r.id, label: label(r) })).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  },

  create(session: StaffSession | null, input: CategoryCreateInput, opts: Opts = {}): { id: number } {
    requirePermission(session, 'categories.write');
    const data = parse(createSchema, input);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const id = withTransaction(db, () => {
      if (data.parentId !== null && !categoriesRepo.findById(db, data.parentId)) throw new ValidationError('Родительская категория не найдена', { parentId: ['Родительская категория не найдена'] });
      const taken = categoriesRepo.allSlugs(db);
      if (data.slug !== '' && taken.has(data.slug)) throw new ConflictError('Slug уже занят другой категорией');
      const slug = data.slug !== '' ? data.slug : freeSlug(slugify(data.name), taken);
      const newId = categoriesRepo.insertManual(db, { externalId: `admin-${randomUUID()}`, parentId: data.parentId, name: data.name, slug, sort: categoriesRepo.nextSort(db, data.parentId) });
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'category.create', entity: 'category', entityId: newId, after: { name: data.name, slug, parentId: data.parentId } }, { db, now });
      return newId;
    });
    clearCategoryImageCache();
    return { id };
  },

  /** Шапка карточки: название, slug, описание, «Активная», позиция в меню, родитель, изображение. */
  async updateHeader(session: StaffSession | null, id: number, input: CategoryHeaderInput, image?: ImageChange, opts: Opts = {}): Promise<{ changed: string[] }> {
    requirePermission(session, 'categories.write');
    const data = parse(headerSchema, input);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const stored = image && 'bytes' in image ? await intakeImage(image.bytes) : null;
    const result = withTransaction(db, () => {
      const current = categoriesRepo.findById(db, id);
      if (!current) throw new NotFoundError('Категория не найдена');
      if (data.parentId !== null) {
        const rows = categoriesRepo.listAll(db);
        if (!rows.some((r) => r.id === data.parentId)) throw new ValidationError('Родительская категория не найдена', { parentId: ['Родительская категория не найдена'] });
        if (subtreeOf(rows, id).has(data.parentId)) throw new ValidationError('Нельзя перенести категорию в саму себя или в её подкатегорию', { parentId: ['Нельзя выбрать саму категорию или её подкатегорию'] });
      }
      const slug = data.slug === '' ? current.slug : data.slug;
      const bySlug = categoriesRepo.findBySlug(db, slug);
      if (bySlug && bySlug.id !== id) throw new ConflictError('Slug уже занят другой категорией');
      const patch: CardPatch = { name: data.name, slug, description: data.description, active: data.active, sort: data.sort, parentId: data.parentId };
      // название и родитель закрепляются, только если их действительно поменяли (иначе импорт перестал бы их обновлять без причины)
      if (data.name === current.name) delete patch.name;
      if (data.parentId === current.parentId) delete patch.parentId;
      if (stored) Object.assign(patch, stored);
      else if (image && 'remove' in image) Object.assign(patch, { imagePath: null, imageVariants: null });
      categoriesRepo.updateCard(db, id, patch);
      if (data.active !== current.active || data.parentId !== current.parentId) categoriesRepo.recomputeEffectiveHidden(db);
      const d = diffOf(headerSnapshot(current), headerSnapshot(categoriesRepo.findById(db, id) as CategoryRow));
      if (d.keys.length > 0) audit.record({ actorId: session.staffId, actorType: 'staff', action: 'category.update', entity: 'category', entityId: id, before: d.before, after: d.after }, { db, now });
      return { changed: d.keys.map(String) };
    });
    if (result.changed.length > 0) clearCategoryImageCache();
    return result;
  },

  /** SEO: Title, Description, H1, SEO-текст, slug, canonical, индексация. */
  updateSeo(session: StaffSession | null, id: number, input: CategorySeoFullInput, opts: Opts = {}): { changed: string[] } {
    requirePermission(session, 'categories.write');
    const data = parse(seoSchema, input);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      const current = categoriesRepo.findById(db, id);
      if (!current) throw new NotFoundError('Категория не найдена');
      const slug = data.slug === '' ? current.slug : data.slug;
      const bySlug = categoriesRepo.findBySlug(db, slug);
      if (bySlug && bySlug.id !== id) throw new ConflictError('Slug уже занят другой категорией');
      const pick = (c: CategoryRow) => ({ seoTitle: c.seoTitle, seoDescription: c.seoDescription, h1: c.h1, seoText: c.seoText, slug: c.slug, canonical: c.canonical, indexable: c.indexable });
      categoriesRepo.updateCard(db, id, { seoTitle: data.seoTitle, seoDescription: data.seoDescription, h1: data.h1, seoText: data.seoText, slug, canonical: data.canonical, indexable: data.indexable });
      const d = diffOf(pick(current), pick(categoriesRepo.findById(db, id) as CategoryRow));
      if (d.keys.length > 0) audit.record({ actorId: session.staffId, actorType: 'staff', action: 'category.seo', entity: 'category', entityId: id, before: d.before, after: d.after }, { db, now });
      return { changed: d.keys.map(String) };
    });
  },

  /** «Дополнительно»: три независимых флага показа, позиция и приоритет, код, внешний ID, комментарий, связанные категории. */
  updateExtra(session: StaffSession | null, id: number, input: CategoryExtraInput, opts: Opts = {}): { changed: string[] } {
    requirePermission(session, 'categories.write');
    const data = parse(extraSchema, input);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const result = withTransaction(db, () => {
      const current = categoriesRepo.findById(db, id);
      if (!current) throw new NotFoundError('Категория не найдена');
      const code = data.code === '' ? (current.code ?? `cat_${id}`) : data.code;
      const sameCode = categoriesRepo.findByCode(db, code);
      if (sameCode && sameCode.id !== id) throw new ConflictError('Код категории уже занят другой категорией');
      const related = [...new Set(data.relatedIds)].filter((r) => r !== id);
      if (data.relatedIds.includes(id)) throw new ValidationError('Категорию нельзя связать с самой собой', { relatedIds: ['Категорию нельзя связать с самой собой'] });
      const known = new Set(categoriesRepo.listAll(db).map((r) => r.id));
      if (related.some((r) => !known.has(r))) throw new ValidationError('Связанная категория не найдена', { relatedIds: ['Связанная категория не найдена'] });
      const beforeRelated = categoryLinksRepo.listRelated(db, id).map((r) => r.id);
      const pick = (c: CategoryRow, rel: number[]) => ({
        showInMenu: c.showInMenu,
        showOnHome: c.showOnHome,
        showInCatalog: c.showInCatalog,
        sort: c.sort,
        priority: c.priority,
        code: c.code,
        externalRef: c.externalRef,
        adminComment: c.adminComment,
        relatedIds: rel,
      });
      categoriesRepo.updateCard(db, id, {
        showInMenu: data.showInMenu,
        showOnHome: data.showOnHome,
        showInCatalog: data.showInCatalog,
        sort: data.sort,
        priority: data.priority,
        code,
        externalRef: data.externalRef,
        adminComment: data.adminComment,
      });
      categoryLinksRepo.replaceRelated(db, id, related);
      const d = diffOf(pick(current, beforeRelated), pick(categoriesRepo.findById(db, id) as CategoryRow, categoryLinksRepo.listRelated(db, id).map((r) => r.id)));
      if (d.keys.length > 0) audit.record({ actorId: session.staffId, actorType: 'staff', action: 'category.update', entity: 'category', entityId: id, before: d.before, after: d.after }, { db, now });
      return { changed: d.keys.map(String) };
    });
    return result;
  },

  /** Удаление запрещено, пока есть товары или подкатегории: предлагается скрыть категорию или перенести содержимое. */
  remove(session: StaffSession | null, id: number, opts: Opts = {}): void {
    requirePermission(session, 'categories.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const current = categoriesRepo.findById(db, id);
      if (!current) throw new NotFoundError('Категория не найдена');
      const children = categoriesRepo.listAll(db).filter((r) => r.parentId === id).length;
      if (children > 0) throw new ConflictError(`В категории подкатегорий: ${children}. Удалить нельзя — перенесите их или скройте категорию (глаз в дереве)`);
      const products = categoriesRepo.directProductCount(db, id);
      if (products > 0) throw new ConflictError(`В категории товаров: ${products}. Удалить нельзя — перенесите товары в другую категорию или скройте категорию (глаз в дереве)`);
      categoriesRepo.delete(db, id);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'category.delete', entity: 'category', entityId: id, before: { name: current.name, slug: current.slug, code: current.code } }, { db, now });
    });
    clearCategoryImageCache();
  },

  // --- Фильтры категории
  filters(session: StaffSession | null, id: number, opts: Opts = {}): CategoryFilterRow[] {
    requirePermission(session, 'catalog.read');
    const db = opts.db ?? getDb();
    const rows = categoriesRepo.listAll(db);
    const byId = new Map(rows.map((r) => [r.id, r]));
    if (!byId.has(id)) throw new NotFoundError('Категория не найдена');
    const chain: number[] = [];
    for (let cur = byId.get(id); cur && !chain.includes(cur.id); cur = cur.parentId === null ? undefined : byId.get(cur.parentId)) chain.push(cur.id);
    const own = new Map(categoryLinksRepo.listFilterSettings(db, id).map((s) => [s.filterId, s]));
    const all = categoryLinksRepo.listAllFilterSettings(db);
    return facetsConfigRepo
      .listEnabled(db)
      .filter((f) => f.categoryIds.length === 0 || f.categoryIds.some((c) => chain.includes(c)))
      .map((f) => {
        const mine = own.get(f.id);
        const ancestors = all.filter((s) => s.filterId === f.id && s.categoryId !== id && chain.includes(s.categoryId)).sort((a, b) => chain.indexOf(a.categoryId) - chain.indexOf(b.categoryId));
        return { filterId: f.id, label: f.label, kind: f.kind, globalSort: f.sort, enabled: mine?.enabled ?? true, sort: mine?.sort ?? null, inheritedOff: !mine && ancestors[0]?.enabled === false };
      });
  },

  /** Сохраняет настройки фильтров категории. Строки «как по умолчанию» (показ, без своего порядка) не хранятся. */
  saveFilters(session: StaffSession | null, id: number, input: CategoryFilterInput, opts: Opts = {}): { changed: boolean } {
    requirePermission(session, 'categories.write');
    const rows = parse(filtersSchema, input);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      if (!categoriesRepo.findById(db, id)) throw new NotFoundError('Категория не найдена');
      const ids = [...new Set(rows.map((r) => r.filterId))];
      const known = categoryLinksRepo.existingFilterIds(db, ids);
      if (ids.some((f) => !known.has(f))) throw new ValidationError('Фильтр не найден');
      const next = new Map(rows.filter((r) => !r.enabled || r.sort !== null).map((r) => [r.filterId, { filterId: r.filterId, sort: r.sort, enabled: r.enabled }]));
      const before = categoryLinksRepo.listFilterSettings(db, id).sort((a, b) => a.filterId - b.filterId);
      const after = [...next.values()].sort((a, b) => a.filterId - b.filterId);
      if (JSON.stringify(before) === JSON.stringify(after)) return { changed: false };
      categoryLinksRepo.replaceFilterSettings(db, id, after);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'category.filters', entity: 'category', entityId: id, before, after }, { db, now });
      return { changed: true };
    });
  },

  // --- Баннеры категории
  banners(session: StaffSession | null, id: number, opts: Opts = {}): { links: BannerLinkRow[]; choices: BannerChoice[] } {
    requirePermission(session, 'catalog.read');
    const db = opts.db ?? getDb();
    if (!categoriesRepo.findById(db, id)) throw new NotFoundError('Категория не найдена');
    return { links: categoryLinksRepo.listBannerLinks(db, id), choices: categoryLinksRepo.listBannerChoices(db, id) };
  },

  addBanner(session: StaffSession | null, id: number, bannerId: unknown, opts: Opts = {}): { added: boolean } {
    requirePermission(session, 'categories.write');
    const banner = parse(idSchema, bannerId);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      if (!categoriesRepo.findById(db, id)) throw new NotFoundError('Категория не найдена');
      if (!categoryLinksRepo.bannerIsForCategories(db, banner)) throw new NotFoundError('Баннер не найден');
      const added = categoryLinksRepo.addBannerLink(db, id, banner, categoryLinksRepo.nextBannerSort(db, id));
      if (added) audit.record({ actorId: session.staffId, actorType: 'staff', action: 'category.banner.add', entity: 'category', entityId: id, after: { bannerId: banner } }, { db, now });
      return { added };
    });
  },

  updateBanner(session: StaffSession | null, id: number, bannerId: unknown, patch: { sort?: unknown; enabled?: unknown }, opts: Opts = {}): { changed: boolean } {
    requirePermission(session, 'categories.write');
    const banner = parse(idSchema, bannerId);
    const data = parse(z.object({ sort: int('Порядок', -100000, 100000).optional(), enabled: flag('Статус').optional() }).strict(), patch);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      if (!categoriesRepo.findById(db, id)) throw new NotFoundError('Категория не найдена');
      const before = categoryLinksRepo.listBannerLinks(db, id).find((l) => l.bannerId === banner);
      if (!before) throw new NotFoundError('Баннер не привязан к категории');
      const same = (data.sort === undefined || data.sort === before.sort) && (data.enabled === undefined || data.enabled === before.enabled);
      if (same) return { changed: false };
      categoryLinksRepo.updateBannerLink(db, id, banner, data);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'category.banner.update', entity: 'category', entityId: id, before: { bannerId: banner, sort: before.sort, enabled: before.enabled }, after: { bannerId: banner, ...data } },
        { db, now },
      );
      return { changed: true };
    });
  },

  /** Убирает только связь; сам баннер остаётся в разделе «Баннеры». */
  removeBanner(session: StaffSession | null, id: number, bannerId: unknown, opts: Opts = {}): { removed: boolean } {
    requirePermission(session, 'categories.write');
    const banner = parse(idSchema, bannerId);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      if (!categoriesRepo.findById(db, id)) throw new NotFoundError('Категория не найдена');
      const removed = categoryLinksRepo.removeBannerLink(db, id, banner);
      if (removed) audit.record({ actorId: session.staffId, actorType: 'staff', action: 'category.banner.remove', entity: 'category', entityId: id, before: { bannerId: banner } }, { db, now });
      return { removed };
    });
  },
};
