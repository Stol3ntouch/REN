import { z } from 'zod';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { audit } from '@/domain/admin/audit';
import { slugify } from '@/importing/yml/slug';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { MAX_SLIDES } from '@/server/db/repositories/slides';
import { NotFoundError, ValidationError } from '@/server/http/errors';
import { intakeImage, type ImageInput } from './images';

/**
 * Общая основа операций админки «Контент»: контекст, проверка права content.write, разбор zod-схем,
 * генерация slug, универсальные save / duplicate / remove с аудитом. Конкретные сущности — в ops.ts и ops-*.ts.
 */
export type Ctx = { db?: Db; now?: number; uploadsDir?: string };
export type { ImageInput };
export type Session = StaffSession | null | undefined;
export type Resolved = { db: Db; now: number; uploadsDir?: string };

export const resolve = (ctx: Ctx): Resolved => ({ db: ctx.db ?? getDb(), now: ctx.now ?? Date.now(), uploadsDir: ctx.uploadsDir });

export function authorize(session: Session, permission: 'content.write' | 'promos.write' | 'reviews.moderate' = 'content.write'): asserts session is StaffSession {
  requirePermission(session, permission);
}

export function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
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

export const opt = (max: number) => z.string().trim().max(max, `Не длиннее ${max} символов`).optional();
export const required = (max: number, msg: string) => z.string().trim().min(1, msg).max(max, `Не длиннее ${max} символов`);
export const image = z.custom<ImageInput>((v) => v === undefined || (typeof v === 'object' && v !== null)).optional();
export const flag = z.boolean().optional();
export const int = z.number().int('Нужно целое число').nullable().optional();
export const stamp = z.number().int().nullable().optional();
export const nul = (v: string | undefined | null): string | null => (v === undefined || v === null || v.trim() === '' ? null : v.trim());

/** Ссылка из админки: путь на сайте (/catalog) или http(s)-адрес. Прочее (javascript:, data:, //host) не принимается. */
export const link = z
  .string()
  .trim()
  .max(300, 'Не длиннее 300 символов')
  .refine((v) => v === '' || (v.startsWith('/') && !v.startsWith('//') && !/\s/.test(v)) || /^https?:\/\/\S+$/i.test(v), 'Ссылка — путь на сайте (/catalog) или адрес https://…')
  .optional();

export const seoShape = {
  slug: opt(100),
  h1: opt(200),
  seoTitle: opt(200),
  seoDescription: opt(400),
  imageAlt: opt(200),
  image,
};

export type SlugRepo = { slugTaken(db: Db, slug: string, exceptId?: number): boolean };

/** Адрес записи: явный (должен быть свободен), прежний или из названия (при коллизии добавляется -2, -3…). */
export function resolveSlug(repo: SlugRepo, db: Db, wanted: string | undefined, title: string, existing: { id: number; slug: string } | null, reserved: readonly string[] = []): string {
  const explicit = nul(wanted);
  const base = slugify(explicit ?? existing?.slug ?? title);
  if (base === '') throw new ValidationError('Адрес (slug) должен содержать буквы или цифры', { slug: ['Адрес (slug) должен содержать буквы или цифры'] });
  const taken = (s: string, except?: number) => reserved.includes(s) || repo.slugTaken(db, s, except);
  if (!taken(base, existing?.id)) return base;
  if (explicit !== null || existing) throw new ValidationError('Такой адрес (slug) уже занят', { slug: ['Такой адрес (slug) уже занят'] });
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken(candidate)) return candidate;
  }
  throw new ValidationError('Не удалось подобрать свободный адрес (slug)');
}

export type Repo<Row, Write> = SlugRepo & {
  get(db: Db, id: number): Row | null;
  insert(db: Db, data: Write, now: number): number;
  update(db: Db, id: number, data: Write, now: number): void;
  remove(db: Db, id: number): void;
};

/** Для аудита: без длинных текстов (они остаются в самой записи). */
export function auditView(row: unknown): unknown {
  if (!row || typeof row !== 'object') return row;
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}…` : v]));
}

export type ImageSlot = { field: string; pathKey: string; variantsKey: string };
const DEFAULT_SLOT: ImageSlot = { field: 'image', pathKey: 'imagePath', variantsKey: 'imageVariants' };

export type EntityConfig<Row extends { id: number }, Write extends object, In extends object> = {
  entity: string;
  repo: Repo<Row, Write>;
  schema: z.ZodType<In>;
  /** Слоты изображений: по умолчанию одно поле image → imagePath/imageVariants. */
  imageSlots?: ImageSlot[];
  hasImage: boolean;
  /** Право на операции (по умолчанию content.write). */
  permission?: 'content.write' | 'promos.write' | 'reviews.moderate';
  /** Проверки перед созданием (лимиты). */
  beforeInsert?(db: Db): void;
  /** Проверки по смыслу перед записью (совместимость, лимиты); бросают ValidationError. */
  validate?(input: In, existing: Row | null, env: { db: Db; now: number }): void;
  build(input: In, existing: Row | null, env: { db: Db; now: number }): Write;
  /** Дописать связанные данные в той же транзакции (привязки, цели). */
  afterSave?(id: number, input: In, existing: Row | null, env: { db: Db; now: number }): void;
  /** Поля копии при дублировании (остальные берутся из оригинала); у дубля — черновик/скрыт. */
  duplicate?(row: Row, env: { db: Db; now: number }): Write;
  /** Дописать связи копии (категории, цели акции). */
  afterDuplicate?(newId: number, sourceId: number, env: { db: Db; now: number }): void;
  /** Дополнительные проверки перед удалением (например, системная запись). */
  beforeRemove?(row: Row, env: { db: Db }): void;
};

export function makeOps<Row extends { id: number }, Write extends object, In extends object>(cfg: EntityConfig<Row, Write, In>) {
  const slots = cfg.imageSlots ?? (cfg.hasImage ? [DEFAULT_SLOT] : []);
  const perm = cfg.permission ?? 'content.write';
  return {
    async save(session: Session, id: number | null, raw: In, ctx: Ctx = {}): Promise<{ id: number }> {
      authorize(session, perm);
      const { db, now, uploadsDir } = resolve(ctx);
      const input = parse(cfg.schema, raw);
      const existing = id === null ? null : cfg.repo.get(db, id);
      if (id !== null && !existing) throw new NotFoundError('Запись не найдена');
      if (!existing) cfg.beforeInsert?.(db);
      cfg.validate?.(input, existing, { db, now });

      const write: Record<string, unknown> = { ...(cfg.build(input, existing, { db, now }) as Record<string, unknown>) };
      for (const slot of slots) {
        const value = (input as Record<string, ImageInput | undefined>)[slot.field];
        if (value?.bytes && value.bytes.byteLength > 0) {
          const stored = await intakeImage(value.bytes, uploadsDir);
          write[slot.pathKey] = stored.imagePath;
          write[slot.variantsKey] = stored.imageVariants;
        } else if (value?.remove) {
          write[slot.pathKey] = null;
          write[slot.variantsKey] = null;
        }
      }

      let savedId: number;
      try {
        savedId = withTransaction(db, () => {
          const target = existing ? existing.id : cfg.repo.insert(db, write as Write, now);
          if (existing) cfg.repo.update(db, existing.id, write as Write, now);
          cfg.afterSave?.(target, input, existing, { db, now });
          return target;
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

    /** Копия записи: новый slug, название «… (копия)», не опубликована. Картинки остаются теми же файлами. */
    async duplicate(session: Session, id: number, ctx: Ctx = {}): Promise<{ id: number }> {
      authorize(session, perm);
      const { db, now } = resolve(ctx);
      const existing = cfg.repo.get(db, id);
      if (!existing) throw new NotFoundError('Запись не найдена');
      if (!cfg.duplicate) throw new ValidationError('Эту запись нельзя дублировать');
      const copy = cfg.duplicate(existing, { db, now });
      const newId = withTransaction(db, () => {
        const created = cfg.repo.insert(db, copy, now);
        cfg.afterDuplicate?.(created, id, { db, now });
        return created;
      });
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: `content.${cfg.entity}.duplicate`, entity: `content_${cfg.entity}`, entityId: newId, before: { sourceId: id }, after: auditView(cfg.repo.get(db, newId)) },
        { db, now },
      );
      return { id: newId };
    },

    async remove(session: Session, id: number, ctx: Ctx = {}): Promise<void> {
      authorize(session, perm);
      const { db, now } = resolve(ctx);
      const existing = cfg.repo.get(db, id);
      if (!existing) throw new NotFoundError('Запись не найдена');
      cfg.beforeRemove?.(existing, { db });
      cfg.repo.remove(db, id);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: `content.${cfg.entity}.delete`, entity: `content_${cfg.entity}`, entityId: id, before: auditView(existing) },
        { db, now },
      );
    },
  };
}

/** Копия slug: «name-copy», «name-copy-2»… — свободный адрес. */
export function copySlug(repo: SlugRepo, db: Db, slug: string, reserved: readonly string[] = []): string {
  const base = slugify(`${slug}-copy`) || 'copy';
  const taken = (s: string) => reserved.includes(s) || repo.slugTaken(db, s);
  if (!taken(base)) return base;
  for (let n = 2; n < 1000; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now()}`;
}
