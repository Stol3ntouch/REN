import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { formatRub } from '@/domain/pricing/format';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { methodsRepo, type DeliveryMethodRow, type DeliveryWrite } from '@/server/db/repositories/methods';
import { ConflictError, NotFoundError, ValidationError } from '@/server/http/errors';

/**
 * Доставка (C12). Правила расчёта выполняет СЕРВЕР при оформлении заказа; браузер только показывает результат.
 *  - стоимость: фиксированная копейками либо «рассчитает менеджер» (null); товары после скидки от порога — доставка бесплатна;
 *  - минимальная сумма заказа: ниже неё способ недоступен;
 *  - география: список регионов/городов; адрес заказа обязан содержать одно из названий, иначе способ недоступен;
 *  - сроки — только текст администратора. Мы их не вычисляем и не выдумываем.
 */

export type DeliveryQuote =
  | { ok: true; priceKopecks: number | null; /** стоимость рассчитает менеджер */ pending: boolean; /** действует порог бесплатной доставки */ free: boolean }
  | { ok: false; reason: 'disabled' | 'min_order' | 'geography'; message: string };

/** Нижний регистр, «ё» → «е», знаки препинания → пробелы: «Г. Москва, ул. Тверская» и «москва» сравнимы. */
export function normalizePlace(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Адрес обслуживается, если содержит (по границам слов) хотя бы одно из названий. null — вся страна. */
export function addressInRegions(address: string, regions: readonly string[] | null): boolean {
  if (regions === null || regions.length === 0) return true;
  const hay = ` ${normalizePlace(address)} `;
  return regions.some((r) => {
    const needle = normalizePlace(r);
    return needle.length >= 2 && hay.includes(` ${needle} `);
  });
}

/**
 * Расчёт способа получения для суммы товаров (в копейках, уже после скидки) и адреса.
 * Адрес null — адрес ещё не введён: география не проверяется (проверит оформление заказа).
 */
export function quoteDelivery(m: DeliveryMethodRow, goodsKopecks: number, address: string | null): DeliveryQuote {
  if (!m.enabled) return { ok: false, reason: 'disabled', message: 'Способ получения недоступен' };
  if (m.minOrderKopecks > 0 && goodsKopecks < m.minOrderKopecks) {
    return { ok: false, reason: 'min_order', message: `Для способа «${m.name}» минимальная сумма заказа — ${formatRub(m.minOrderKopecks)}` };
  }
  if (m.requiresAddress && m.regions && address !== null && !addressInRegions(address, m.regions)) {
    return { ok: false, reason: 'geography', message: `Способ «${m.name}» не обслуживает указанный адрес` };
  }
  if (m.freeFromKopecks !== null && goodsKopecks >= m.freeFromKopecks) return { ok: true, priceKopecks: 0, pending: false, free: true };
  return { ok: true, priceKopecks: m.priceKopecks, pending: m.priceKopecks === null, free: false };
}

// ---------------------------------------------------------------- администрирование (shipping.write)

type Opts = { db?: Db; now?: number };

const money = z.number().int('Сумма в целых копейках').min(0, 'Сумма не может быть отрицательной').max(100_000_000_00, 'Слишком большая сумма');
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Не длиннее ${max} знаков`)
    .transform((v) => (v === '' ? null : v));

export const deliveryInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Название: не короче 2 знаков').max(120, 'Название: не длиннее 120 знаков'),
    description: text(500).nullish().transform((v) => v ?? null),
    kind: z.enum(['pickup', 'manual'], { error: 'Неизвестный вид способа' }),
    /** null — стоимость рассчитает менеджер. */
    priceKopecks: money.nullable(),
    requiresAddress: z.boolean(),
    enabled: z.boolean(),
    sort: z.number().int().min(0).max(9999),
    freeFromKopecks: money.min(1, 'Порог бесплатной доставки: больше нуля').nullable(),
    /** null или пустой список — вся страна. */
    regions: z
      .array(z.string().trim().min(2, 'Название региона: не короче 2 знаков').max(80, 'Название региона: не длиннее 80 знаков'))
      .max(200, 'Не больше 200 регионов')
      .nullable(),
    etaText: text(120).nullish().transform((v) => v ?? null),
    minOrderKopecks: money,
  })
  .superRefine((v, ctx) => {
    if (v.freeFromKopecks !== null && v.priceKopecks === 0) {
      ctx.addIssue({ code: 'custom', path: ['freeFromKopecks'], message: 'Порог бесплатной доставки не нужен: доставка и так бесплатна' });
    }
    if (v.kind === 'pickup' && v.regions && v.regions.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['regions'], message: 'География не применяется к самовывозу' });
    }
  });

export type DeliveryInput = z.input<typeof deliveryInputSchema>;

function parse(input: unknown): DeliveryWrite {
  const r = deliveryInputSchema.safeParse(input);
  if (!r.success) {
    const fields: Record<string, string[]> = {};
    for (const i of r.error.issues) (fields[String(i.path[0] ?? 'form')] ??= []).push(i.message);
    throw new ValidationError(r.error.issues[0]?.message ?? 'Проверьте поля формы', fields);
  }
  const v = r.data;
  const regions = v.regions && v.regions.length > 0 ? [...new Set(v.regions)] : null;
  return { ...v, regions };
}

const snapshot = (m: DeliveryMethodRow) => ({
  name: m.name,
  kind: m.kind,
  priceKopecks: m.priceKopecks,
  freeFromKopecks: m.freeFromKopecks,
  regions: m.regions?.length ?? 0,
  minOrderKopecks: m.minOrderKopecks,
  enabled: m.enabled,
});

export const deliveryAdmin = {
  list(session: StaffSession | null, opts: Opts = {}): DeliveryMethodRow[] {
    requirePermission(session, 'shipping.write');
    return methodsRepo.listDelivery(opts.db ?? getDb());
  },

  create(session: StaffSession | null, input: unknown, opts: Opts = {}): number {
    requirePermission(session, 'shipping.write');
    const w = parse(input);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      const id = methodsRepo.insertDelivery(db, w);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'delivery.create', entity: 'delivery_method', entityId: id, after: snapshot(methodsRepo.findDelivery(db, id)!) }, { db, now });
      return id;
    });
  },

  update(session: StaffSession | null, id: number, input: unknown, opts: Opts = {}): void {
    requirePermission(session, 'shipping.write');
    const w = parse(input);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const before = methodsRepo.findDelivery(db, id);
      if (!before) throw new NotFoundError('Способ получения не найден');
      methodsRepo.updateDelivery(db, id, w);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'delivery.update', entity: 'delivery_method', entityId: id, before: snapshot(before), after: snapshot(methodsRepo.findDelivery(db, id)!) },
        { db, now },
      );
    });
  },

  setEnabled(session: StaffSession | null, id: number, enabled: boolean, opts: Opts = {}): void {
    requirePermission(session, 'shipping.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const m = methodsRepo.findDelivery(db, id);
      if (!m) throw new NotFoundError('Способ получения не найден');
      if (m.enabled === enabled) return;
      if (!enabled && methodsRepo.listDelivery(db, { enabledOnly: true }).filter((x) => x.id !== id).length === 0) {
        throw new ConflictError('Нельзя отключить последний способ получения: оформление заказов остановится');
      }
      methodsRepo.updateDelivery(db, id, { ...m, enabled });
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'delivery.toggle', entity: 'delivery_method', entityId: id, before: { enabled: m.enabled }, after: { enabled } }, { db, now });
    });
  },

  /** Удалить можно способ, по которому не было заказов; иначе — только отключить (заказы хранят снимок, но ссылаются на способ). */
  remove(session: StaffSession | null, id: number, opts: Opts = {}): void {
    requirePermission(session, 'shipping.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const m = methodsRepo.findDelivery(db, id);
      if (!m) throw new NotFoundError('Способ получения не найден');
      if (methodsRepo.countOrdersByDelivery(db, id) > 0) throw new ConflictError('По этому способу уже есть заказы: удалить нельзя, отключите его');
      if (m.enabled && methodsRepo.listDelivery(db, { enabledOnly: true }).filter((x) => x.id !== id).length === 0) {
        throw new ConflictError('Нельзя удалить последний способ получения: оформление заказов остановится');
      }
      methodsRepo.deleteDelivery(db, id);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'delivery.delete', entity: 'delivery_method', entityId: id, before: snapshot(m) }, { db, now });
    });
  },
};
