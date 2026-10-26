import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { categoriesRepo, type CategoryRow } from '@/server/db/repositories/categories';
import { NotFoundError, ValidationError, type FieldErrors } from '@/server/http/errors';

type Opts = { db?: Db; now?: number };

/** Пустая строка после обрезки → null (поле очищено). */
const optional = (max: number, label: string) =>
  z
    .string({ error: `${label}: нужен текст` })
    .trim()
    .max(max, `${label}: не длиннее ${max} символов`)
    .transform((v) => (v === '' ? null : v));

const schema = z
  .object({
    seoTitle: optional(200, 'Title'),
    seoDescription: optional(500, 'Description'),
    h1: optional(200, 'H1'),
    seoText: optional(5000, 'SEO-текст'),
  })
  .strict();

export type CategorySeoInput = z.input<typeof schema>;
export type CategorySeoRow = { id: number; name: string; slug: string; depth: number; hasSeoText: boolean };

const KEYS = ['seoTitle', 'seoDescription', 'h1', 'seoText'] as const;

function toValidation(error: z.ZodError): ValidationError {
  const fields: FieldErrors = {};
  for (const i of error.issues) (fields[String(i.path[0] ?? 'form')] ??= []).push(i.message);
  return new ValidationError(Object.values(fields)[0]?.[0] ?? 'Проверьте введённые данные', fields);
}

/**
 * SEO-поля категорий — контент сайта, а не данные 1С: флаг catalog.manualEdit не нужен,
 * импорт YML эти поля не перезаписывает. Чтение — catalog.read, запись — categories.write.
 */
export const categorySeoOps = {
  /** Дерево категорий (родитель перед детьми) с глубиной и признаком «SEO-текст заполнен». */
  list(session: StaffSession | null, opts: Opts = {}): CategorySeoRow[] {
    requirePermission(session, 'catalog.read');
    const rows = categoriesRepo.listAll(opts.db ?? getDb());
    const ids = new Set(rows.map((r) => r.id));
    const byParent = new Map<number | null, CategoryRow[]>();
    for (const r of rows) {
      const key = r.parentId !== null && ids.has(r.parentId) ? r.parentId : null;
      const bucket = byParent.get(key) ?? [];
      bucket.push(r);
      byParent.set(key, bucket);
    }
    const out: CategorySeoRow[] = [];
    const walk = (parent: number | null, depth: number) => {
      for (const r of byParent.get(parent) ?? []) {
        out.push({ id: r.id, name: r.name, slug: r.slug, depth, hasSeoText: (r.seoText ?? '').trim() !== '' });
        walk(r.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  },

  get(session: StaffSession | null, id: number, opts: Opts = {}): CategoryRow | null {
    requirePermission(session, 'catalog.read');
    return categoriesRepo.findById(opts.db ?? getDb(), id) ?? null;
  },

  /** Сохраняет четыре SEO-поля; аудит (до/после только изменённых полей) пишется, если что-то изменилось. */
  update(session: StaffSession | null, id: number, input: unknown, opts: Opts = {}): { changed: string[] } {
    requirePermission(session, 'categories.write');
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw toValidation(parsed.error);
    const next = parsed.data;
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      const current = categoriesRepo.findById(db, id);
      if (!current) throw new NotFoundError('Категория не найдена');
      const changed = KEYS.filter((k) => (current[k] ?? null) !== next[k]);
      if (changed.length === 0) return { changed: [] };
      categoriesRepo.updateSeo(db, id, next);
      audit.record(
        {
          actorId: session.staffId,
          actorType: 'staff',
          action: 'category.seo',
          entity: 'category',
          entityId: id,
          before: Object.fromEntries(changed.map((k) => [k, current[k] ?? null])),
          after: Object.fromEntries(changed.map((k) => [k, next[k]])),
        },
        { db, now },
      );
      return { changed: [...changed] };
    });
  },
};
