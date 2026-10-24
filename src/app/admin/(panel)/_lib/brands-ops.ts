import { audit } from '@/domain/admin/audit';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { brandSchema, brandSlug, LOGO_MAX_BYTES, type BrandInput } from '@/domain/catalog/brands';
import { zodToValidation } from '@/domain/catalog/validation';
import { ImageStoreError, storeImage } from '@/media/store-image';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { brandsRepo, type BrandListQuery, type BrandRow } from '@/server/db/repositories/brands';
import { ConflictError, NotFoundError, ValidationError } from '@/server/http/errors';

type Opts = { db?: Db; now?: number };
/** Логотип: новый файл (байты), удалить или не менять. */
export type LogoChange = { bytes: Uint8Array } | { remove: true } | undefined;

const iso = (now: number) => new Date(now).toISOString();

/** Поля бренда для журнала (без служебных). */
function snapshot(b: BrandRow) {
  return { name: b.name, slug: b.slug, description: b.description, siteUrl: b.siteUrl, published: b.published, archived: b.archived, sort: b.sort, seoTitle: b.seoTitle, seoDescription: b.seoDescription, logo: b.logoPath };
}

function diff(before: ReturnType<typeof snapshot>, after: ReturnType<typeof snapshot>) {
  const keys = (Object.keys(after) as (keyof typeof after)[]).filter((k) => before[k] !== after[k]);
  return { keys, before: Object.fromEntries(keys.map((k) => [k, before[k]])), after: Object.fromEntries(keys.map((k) => [k, after[k]])) };
}

async function intakeLogo(bytes: Uint8Array): Promise<{ logoPath: string; logoVariants: string }> {
  if (bytes.byteLength === 0) throw new ValidationError('Логотип: файл пустой', { logo: ['Файл пустой'] });
  if (bytes.byteLength > LOGO_MAX_BYTES) throw new ValidationError('Логотип: файл больше 2 МБ', { logo: ['Файл больше 2 МБ'] });
  try {
    const stored = await storeImage(bytes);
    return { logoPath: stored.path, logoVariants: JSON.stringify(stored.variants) };
  } catch (e) {
    if (e instanceof ImageStoreError) throw new ValidationError(`Логотип: ${e.message}`, { logo: [e.message] });
    throw e;
  }
}

function parse(input: unknown) {
  const parsed = brandSchema.safeParse(input);
  if (!parsed.success) throw zodToValidation(parsed.error);
  return parsed.data;
}

/**
 * Бренды (G25). Чтение — catalog.read, запись — catalog.write (старый ключ; точные права появятся с C02).
 * Каждое изменение пишется в журнал (brand.*). Удалять бренд с товарами нельзя: архивируйте или перенесите товары.
 */
export const brandOps = {
  list(session: StaffSession | null, query: BrandListQuery, opts: Opts = {}) {
    requirePermission(session, 'catalog.read');
    return brandsRepo.list(opts.db ?? getDb(), query);
  },

  /** Все бренды для выпадающих списков (без архивных, кроме includeArchived). */
  options(session: StaffSession | null, opts: Opts & { includeArchived?: boolean } = {}): BrandRow[] {
    requirePermission(session, 'catalog.read');
    return brandsRepo.listAll(opts.db ?? getDb(), { includeArchived: opts.includeArchived ?? false });
  },

  get(session: StaffSession | null, id: number, opts: Opts = {}): (BrandRow & { productCount: number }) | null {
    requirePermission(session, 'catalog.read');
    const db = opts.db ?? getDb();
    const b = brandsRepo.findById(db, id);
    return b ? { ...b, productCount: brandsRepo.productCount(db, id) } : null;
  },

  products(session: StaffSession | null, id: number, page: { limit: number; offset: number }, opts: Opts = {}) {
    requirePermission(session, 'catalog.read');
    const db = opts.db ?? getDb();
    return { total: brandsRepo.productCount(db, id), rows: brandsRepo.listProducts(db, id, page.limit, page.offset) };
  },

  searchProductsToAttach(session: StaffSession | null, id: number, text: string, opts: Opts = {}) {
    requirePermission(session, 'catalog.read');
    const q = text.trim();
    if (q.length < 2) return [];
    return brandsRepo.searchProductsToAttach(opts.db ?? getDb(), id, q.slice(0, 100), 30);
  },

  async create(session: StaffSession | null, input: BrandInput, logo?: LogoChange, opts: Opts = {}): Promise<{ id: number }> {
    requirePermission(session, 'catalog.write');
    const data = parse(input);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const stored = logo && 'bytes' in logo ? await intakeLogo(logo.bytes) : null;
    return withTransaction(db, () => {
      if (brandsRepo.findByName(db, data.name)) throw new ValidationError('Бренд с таким названием уже есть', { name: ['Бренд с таким названием уже есть'] });
      if (data.slug !== '' && brandsRepo.findBySlug(db, data.slug)) throw new ConflictError('Slug уже занят другим брендом');
      const slug = brandSlug(data.slug, data.name, brandsRepo.allSlugs(db));
      const id = brandsRepo.insert(db, { ...data, slug, logoPath: stored?.logoPath ?? null, logoVariants: stored?.logoVariants ?? null }, iso(now));
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'brand.create', entity: 'brand', entityId: id, after: snapshot(brandsRepo.findById(db, id) as BrandRow) }, { db, now });
      return { id };
    });
  },

  async update(session: StaffSession | null, id: number, input: BrandInput, logo?: LogoChange, opts: Opts = {}): Promise<{ changed: string[] }> {
    requirePermission(session, 'catalog.write');
    const data = parse(input);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const stored = logo && 'bytes' in logo ? await intakeLogo(logo.bytes) : null;
    return withTransaction(db, () => {
      const current = brandsRepo.findById(db, id);
      if (!current) throw new NotFoundError('Бренд не найден');
      const same = brandsRepo.findByName(db, data.name);
      if (same && same.id !== id) throw new ValidationError('Бренд с таким названием уже есть', { name: ['Бренд с таким названием уже есть'] });
      const slug = data.slug === '' ? current.slug : data.slug;
      const bySlug = brandsRepo.findBySlug(db, slug);
      if (bySlug && bySlug.id !== id) throw new ConflictError('Slug уже занят другим брендом');
      const logoPatch = stored ? { logoPath: stored.logoPath, logoVariants: stored.logoVariants } : logo && 'remove' in logo ? { logoPath: null, logoVariants: null } : {};
      brandsRepo.update(db, id, { ...data, slug, ...logoPatch }, iso(now));
      const d = diff(snapshot(current), snapshot(brandsRepo.findById(db, id) as BrandRow));
      if (d.keys.length > 0) audit.record({ actorId: session.staffId, actorType: 'staff', action: 'brand.update', entity: 'brand', entityId: id, before: d.before, after: d.after }, { db, now });
      return { changed: d.keys.map(String) };
    });
  },

  /** Архивировать (убрать из списков и с витрины) или вернуть из архива. */
  setArchived(session: StaffSession | null, id: number, archived: boolean, opts: Opts = {}): void {
    requirePermission(session, 'catalog.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const b = brandsRepo.findById(db, id);
      if (!b) throw new NotFoundError('Бренд не найден');
      if (b.archived === archived) return;
      brandsRepo.setArchived(db, id, archived, iso(now));
      audit.record({ actorId: session.staffId, actorType: 'staff', action: archived ? 'brand.archive' : 'brand.restore', entity: 'brand', entityId: id, before: { archived: b.archived }, after: { archived } }, { db, now });
    });
  },

  setPublished(session: StaffSession | null, id: number, published: boolean, opts: Opts = {}): void {
    requirePermission(session, 'catalog.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const b = brandsRepo.findById(db, id);
      if (!b) throw new NotFoundError('Бренд не найден');
      if (b.published === published) return;
      brandsRepo.setPublished(db, id, published, iso(now));
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'brand.publish', entity: 'brand', entityId: id, before: { published: b.published }, after: { published } }, { db, now });
    });
  },

  /**
   * Удаление. С привязанными товарами запрещено (ConflictError с подсказкой), кроме явного переноса товаров в другой бренд
   * (moveToId) или снятия бренда (moveToId = null и detach = true).
   */
  remove(session: StaffSession | null, id: number, opts: Opts & { moveToId?: number | null; detach?: boolean } = {}): { moved: number } {
    requirePermission(session, 'catalog.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      const b = brandsRepo.findById(db, id);
      if (!b) throw new NotFoundError('Бренд не найден');
      const count = brandsRepo.productCount(db, id);
      let moved = 0;
      if (count > 0) {
        if (opts.moveToId == null && !opts.detach) {
          throw new ConflictError(`К бренду привязано товаров: ${count}. Удалить нельзя — заархивируйте бренд или перенесите товары в другой бренд`);
        }
        if (opts.moveToId != null) {
          const target = brandsRepo.findById(db, opts.moveToId);
          if (!target || target.id === id) throw new ValidationError('Выберите другой бренд для переноса товаров');
          if (target.archived) throw new ValidationError('Нельзя переносить товары в архивный бренд');
        }
        moved = brandsRepo.moveProducts(db, id, opts.moveToId ?? null);
      }
      brandsRepo.delete(db, id);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'brand.delete', entity: 'brand', entityId: id, before: snapshot(b), after: count > 0 ? { movedProducts: moved, toBrandId: opts.moveToId ?? null } : undefined },
        { db, now },
      );
      return { moved };
    });
  },

  /** Привязать товары к бренду (список id). Возвращает число изменённых. */
  attachProducts(session: StaffSession | null, id: number, productIds: number[], opts: Opts = {}): number {
    requirePermission(session, 'catalog.write');
    const ids = [...new Set(productIds.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500);
    if (ids.length === 0) throw new ValidationError('Выберите товары');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      const b = brandsRepo.findById(db, id);
      if (!b) throw new NotFoundError('Бренд не найден');
      if (b.archived) throw new ConflictError('Бренд в архиве: верните его из архива, чтобы привязывать товары');
      const n = brandsRepo.assignProducts(db, id, ids);
      if (n > 0) audit.record({ actorId: session.staffId, actorType: 'staff', action: 'brand.products.attach', entity: 'brand', entityId: id, after: { productIds: ids, changed: n } }, { db, now });
      return n;
    });
  },

  /** Отвязать товары от бренда. Чужие товары (другого бренда) не затрагиваются. */
  detachProducts(session: StaffSession | null, id: number, productIds: number[], opts: Opts = {}): number {
    requirePermission(session, 'catalog.write');
    const ids = [...new Set(productIds.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500);
    if (ids.length === 0) throw new ValidationError('Выберите товары');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      if (!brandsRepo.findById(db, id)) throw new NotFoundError('Бренд не найден');
      let n = 0;
      for (const pid of ids) {
        if (brandsRepo.getProductBrandId(db, pid) === id) {
          brandsRepo.setProductBrand(db, pid, null);
          n += 1;
        }
      }
      if (n > 0) audit.record({ actorId: session.staffId, actorType: 'staff', action: 'brand.products.detach', entity: 'brand', entityId: id, before: { productIds: ids }, after: { detached: n } }, { db, now });
      return n;
    });
  },
};
