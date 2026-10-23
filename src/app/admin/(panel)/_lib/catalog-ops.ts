import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { sanitizeDescription } from '@/importing/yml';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { catalogAdminRepo, type AdminProductRow, type ProductListFilter } from '@/server/db/repositories/catalog-admin';
import { adminFlagsRepo } from '@/server/db/repositories/staff-admin';
import { ForbiddenError, NotFoundError, ValidationError, type FieldErrors } from '@/server/http/errors';

type Opts = { db?: Db; now?: number };

const MAX_KOPECKS = 10_000_000_000; // 100 млн ₽

const updateSchema = z
  .object({
    priceKopecks: z.number({ error: 'Цена — число' }).int('Цена в копейках — целое').min(0, 'Цена не может быть отрицательной').max(MAX_KOPECKS, 'Слишком большая цена'),
    discountPriceKopecks: z.number().int().min(0).max(MAX_KOPECKS).nullable(),
    published: z.boolean(),
    featured: z.boolean(),
    description: z.string().max(20_000, 'Описание слишком длинное').nullable(),
    seoTitle: z.string().trim().max(200, 'SEO-заголовок не длиннее 200 символов').nullable(),
    seoDescription: z.string().trim().max(500, 'SEO-описание не длиннее 500 символов').nullable(),
  })
  .partial()
  .strict();

export type ProductUpdateInput = z.input<typeof updateSchema>;

function toValidation(error: z.ZodError): ValidationError {
  const fields: FieldErrors = {};
  for (const i of error.issues) (fields[String(i.path[0] ?? 'form')] ??= []).push(i.message);
  return new ValidationError(Object.values(fields)[0]?.[0] ?? 'Проверьте введённые данные', fields);
}

const LOCK_ON_CHANGE: Record<string, string> = {
  price: 'price',
  discount_price: 'discount_price',
  published: 'published',
  featured: 'featured',
  description: 'description',
  seo_title: 'seo_title',
  seo_description: 'seo_description',
};

export type FieldSnapshot = Partial<{
  price: number;
  discount_price: number | null;
  published: boolean;
  featured: boolean;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
}>;

function snapshot(p: AdminProductRow): Required<FieldSnapshot> {
  return {
    price: p.priceKopecks,
    discount_price: p.discountPriceKopecks,
    published: p.published,
    featured: p.featured,
    description: p.description,
    seo_title: p.seoTitle,
    seo_description: p.seoDescription,
  };
}

export const catalogOps = {
  isManualEditEnabled(db: Db = getDb()): boolean {
    return adminFlagsRepo.isManualEditEnabled(db);
  },

  list(session: StaffSession | null, filter: ProductListFilter, opts: Opts = {}) {
    requirePermission(session, 'catalog.read');
    return catalogAdminRepo.list(opts.db ?? getDb(), filter);
  },

  categories(session: StaffSession | null, opts: Opts = {}) {
    requirePermission(session, 'catalog.read');
    return catalogAdminRepo.categories(opts.db ?? getDb());
  },

  get(session: StaffSession | null, id: number, opts: Opts = {}): { product: AdminProductRow; manualEdit: boolean } | null {
    requirePermission(session, 'catalog.read');
    const db = opts.db ?? getDb();
    const product = catalogAdminRepo.findById(db, id);
    return product ? { product, manualEdit: adminFlagsRepo.isManualEditEnabled(db) } : null;
  },

  /**
   * Ручная правка. Нужны право catalog.write И включённый catalog.manualEdit (иначе источник истины — 1С/YML).
   * Меняются только отличающиеся поля; каждое попадает в locked_fields, чтобы импорт его не перезаписал; пишется аудит.
   */
  update(session: StaffSession | null, id: number, input: unknown, opts: Opts = {}): { changed: string[] } {
    requirePermission(session, 'catalog.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    if (!adminFlagsRepo.isManualEditEnabled(db)) {
      throw new ForbiddenError('Ручное редактирование каталога выключено: источник данных — импорт/1С. Включите его в настройках.');
    }
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) throw toValidation(parsed.error);
    const patch = parsed.data;

    return withTransaction(db, () => {
      const current = catalogAdminRepo.findById(db, id);
      if (!current) throw new NotFoundError('Товар не найден');
      const before = snapshot(current);

      const next = { ...before };
      if (patch.priceKopecks !== undefined) next.price = patch.priceKopecks;
      if (patch.discountPriceKopecks !== undefined) next.discount_price = patch.discountPriceKopecks === 0 ? null : patch.discountPriceKopecks;
      if (patch.published !== undefined) next.published = patch.published;
      if (patch.featured !== undefined) next.featured = patch.featured;
      if (patch.description !== undefined) next.description = patch.description === null || patch.description.trim() === '' ? null : sanitizeDescription(patch.description);
      if (patch.seoTitle !== undefined) next.seo_title = patch.seoTitle === '' ? null : patch.seoTitle;
      if (patch.seoDescription !== undefined) next.seo_description = patch.seoDescription === '' ? null : patch.seoDescription;

      if (next.discount_price !== null && next.discount_price >= next.price) {
        throw new ValidationError('Скидочная цена должна быть меньше обычной', { discountPriceKopecks: ['Скидочная цена должна быть меньше обычной'] });
      }

      const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== before[k]);
      if (changed.length === 0) return { changed: [] };

      catalogAdminRepo.updateFields(
        db,
        id,
        {
          ...(changed.includes('price') ? { priceKopecks: next.price } : {}),
          ...(changed.includes('discount_price') ? { discountPriceKopecks: next.discount_price } : {}),
          ...(changed.includes('published') ? { published: next.published } : {}),
          ...(changed.includes('featured') ? { featured: next.featured } : {}),
          ...(changed.includes('description') ? { description: next.description } : {}),
        },
        new Date(now).toISOString(),
      );
      if (changed.includes('seo_title') || changed.includes('seo_description')) {
        catalogAdminRepo.upsertSeo(db, id, { title: next.seo_title, description: next.seo_description }, now);
      }
      const locked = new Set(current.lockedFields);
      for (const k of changed) locked.add(LOCK_ON_CHANGE[k]!);
      catalogAdminRepo.setLocked(db, id, [...locked]);

      const pick = (src: Required<FieldSnapshot>) => Object.fromEntries(changed.map((k) => [k, src[k]]));
      audit.record(
        {
          actorId: session.staffId,
          actorType: 'staff',
          action: changed.includes('price') || changed.includes('discount_price') ? 'price.change' : 'product.update',
          entity: 'product',
          entityId: id,
          before: pick(before),
          after: pick(next),
        },
        { db, now },
      );
      return { changed };
    });
  },

  /** Вернуть поля под управление импорта (снять закрепление). Тоже только при включённом ручном режиме и catalog.write. */
  unlock(session: StaffSession | null, id: number, fields: string[], opts: Opts = {}): void {
    requirePermission(session, 'catalog.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    if (!adminFlagsRepo.isManualEditEnabled(db)) throw new ForbiddenError('Ручное редактирование каталога выключено');
    withTransaction(db, () => {
      const current = catalogAdminRepo.findById(db, id);
      if (!current) throw new NotFoundError('Товар не найден');
      const drop = new Set(fields);
      const next = current.lockedFields.filter((f) => !drop.has(f));
      if (next.length === current.lockedFields.length) return;
      catalogAdminRepo.setLocked(db, id, next);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'product.unlock', entity: 'product', entityId: id, before: { locked: current.lockedFields }, after: { locked: next } },
        { db, now },
      );
    });
  },
};
