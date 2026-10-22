import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { requirePermission, type Permission, type StaffSession } from '@/domain/admin/permissions';
import { normalizePromoCode } from '@/domain/pricing';
import { getDb, withTransaction } from '@/server/db/connection';
import { ordersRepo, type OrderListFilter, type OrderRow, type OrderStatus } from '@/server/db/repositories/orders';
import { promosRepo, type PromoRow, type PromoWrite } from '@/server/db/repositories/promos';
import { staffRepo } from '@/server/db/repositories/staff';
import { ConflictError, NotFoundError, ValidationError, type FieldErrors } from '@/server/http/errors';
import { orders } from './orders';
import { isOrderStatus } from './status';
import type { Actor, Opts, Order, OrderEvent } from './types';

/**
 * Операции админки над заказами и промокодами. Каждая САМА проверяет право (requirePermission) —
 * server actions и страницы вызывают их, получив сессию через requireStaff; обойти проверку нельзя.
 * Матрица (spec): заказы — orders.read/orders.write (admin, manager); промокоды — просмотр catalog.read,
 * запись promos.write (только admin); возврат средств — только admin (право settings.write).
 */
export const REFUND_PERMISSION: Permission = 'settings.write';
export const ORDERS_PAGE_SIZE = 30;

const actorOf = (s: StaffSession): Actor => ({ type: 'staff', staffId: s.staffId, role: s.role });

export type OrderFilters = {
  q?: string;
  status?: OrderStatus;
  from?: number;
  to?: number;
  assignedStaffId?: number | 'none';
  page?: number;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD → начало суток по Москве (UTC+3), мс; невозможная дата → undefined. */
export function moscowDayStart(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = DATE_RE.exec(value);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return undefined;
  return Date.parse(`${value}T00:00:00+03:00`);
}

const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

/** Фильтры из адресной строки: всё лишнее и неверное молча отбрасывается. */
export function parseOrderFilters(sp: Record<string, unknown>): OrderFilters {
  const out: OrderFilters = {};
  const q = first(sp.q);
  if (typeof q === 'string' && q.trim() !== '') out.q = q.trim().slice(0, 100);
  const status = first(sp.status);
  if (isOrderStatus(status)) out.status = status;
  const from = moscowDayStart(first(sp.from));
  if (from !== undefined) out.from = from;
  const toStart = moscowDayStart(first(sp.to));
  if (toStart !== undefined) out.to = toStart + 86_400_000; // «по» включает весь день
  const as = first(sp.assigned);
  if (as === 'none') out.assignedStaffId = 'none';
  else if (typeof as === 'string' && /^\d{1,9}$/.test(as)) out.assignedStaffId = Number(as);
  const page = Number(first(sp.page));
  out.page = Number.isInteger(page) && page >= 1 ? page : 1;
  return out;
}

export type OrderListResult = { rows: OrderRow[]; total: number; page: number; pageSize: number };

export const orderOps = {
  list(session: StaffSession | null, filters: OrderFilters, opts: Opts = {}): OrderListResult {
    requirePermission(session, 'orders.read');
    const db = opts.db ?? getDb();
    const page = Math.max(1, filters.page ?? 1);
    const repoFilter: OrderListFilter = {
      q: filters.q,
      status: filters.status,
      from: filters.from,
      to: filters.to,
      assignedStaffId: filters.assignedStaffId,
      limit: ORDERS_PAGE_SIZE,
      offset: (page - 1) * ORDERS_PAGE_SIZE,
    };
    const { rows, total } = ordersRepo.list(db, repoFilter);
    return { rows, total, page, pageSize: ORDERS_PAGE_SIZE };
  },

  get(session: StaffSession | null, number: string, opts: Opts = {}): Order | null {
    requirePermission(session, 'orders.read');
    return orders.getForStaff(number, opts);
  },

  history(session: StaffSession | null, orderId: number, opts: Opts = {}): OrderEvent[] {
    requirePermission(session, 'orders.read');
    return orders.events(orderId, opts);
  },

  /** Сотрудники, которым можно назначить заказ. */
  staffForAssignment(session: StaffSession | null, opts: Opts = {}): Array<{ id: number; label: string }> {
    requirePermission(session, 'orders.read');
    return staffRepo
      .list(opts.db ?? getDb())
      .filter((s) => s.active)
      .map((s) => ({ id: s.id, label: s.name ?? s.email }));
  },

  async changeStatus(session: StaffSession | null, orderId: number, to: OrderStatus, note: string | undefined, opts: Opts = {}): Promise<Order> {
    requirePermission(session, 'orders.write');
    return orders.transition(orderId, to, actorOf(session), note, { ...opts, viaRefund: false });
  },

  /** Отмена (admin и manager). Оплаченный заказ отменить нельзя — возврат. */
  async cancel(session: StaffSession | null, orderId: number, reason: string | undefined, opts: Opts = {}): Promise<Order> {
    requirePermission(session, 'orders.write');
    return orders.transition(orderId, 'cancelled', actorOf(session), reason, { ...opts, viaRefund: false });
  },

  /** Возврат оплаченного — только администратор. */
  async refund(session: StaffSession | null, orderId: number, note: string | undefined, opts: Opts = {}): Promise<Order> {
    requirePermission(session, REFUND_PERMISSION);
    return orders.refund(orderId, actorOf(session), note, { ...opts, viaRefund: false });
  },

  assign(session: StaffSession | null, orderId: number, staffId: number | null, opts: Opts = {}): Order {
    requirePermission(session, 'orders.write');
    return orders.assign(orderId, staffId, actorOf(session), opts);
  },

  addNote(session: StaffSession | null, orderId: number, text: string, opts: Opts = {}): void {
    requirePermission(session, 'orders.write');
    orders.addNote(orderId, text, actorOf(session), opts);
  },
};

// ---------------------------------------------------------------- промокоды

const promoSchema = z
  .object({
    code: z
      .string({ error: 'Введите код' })
      .transform(normalizePromoCode)
      .pipe(z.string().regex(/^[A-Z0-9_-]{3,32}$/, 'Код: 3–32 символа, латинские буквы, цифры, «-» и «_»')),
    type: z.enum(['percent', 'fixed'], { error: 'Выберите тип скидки' }),
    value: z.number({ error: 'Укажите размер скидки' }).int('Размер скидки — целое число').positive('Размер скидки должен быть больше нуля'),
    startsAt: z.number().int().nullable(),
    endsAt: z.number().int().nullable(),
    usageLimit: z.number().int('Лимит — целое число').positive('Лимит должен быть больше нуля').nullable(),
    minSubtotalKopecks: z.number().int().min(0, 'Минимальная сумма не может быть отрицательной'),
    enabled: z.boolean(),
  })
  .refine((v) => v.type !== 'percent' || v.value <= 100, { path: ['value'], message: 'Процент — от 1 до 100' })
  .refine((v) => v.startsAt === null || v.endsAt === null || v.startsAt <= v.endsAt, {
    path: ['endsAt'],
    message: 'Окончание не может быть раньше начала',
  });

export type PromoInput = z.input<typeof promoSchema>;

function parsePromo(input: unknown): PromoWrite {
  const res = promoSchema.safeParse(input);
  if (res.success) return res.data;
  const fields: FieldErrors = {};
  for (const issue of res.error.issues) (fields[String(issue.path[0] ?? 'form')] ??= []).push(issue.message);
  throw new ValidationError(Object.values(fields)[0]?.[0] ?? 'Проверьте данные промокода', fields);
}

const promoSnapshot = (p: PromoRow | PromoWrite) => ({
  code: p.code,
  type: p.type,
  value: p.value,
  startsAt: p.startsAt,
  endsAt: p.endsAt,
  usageLimit: p.usageLimit,
  minSubtotalKopecks: p.minSubtotalKopecks,
  enabled: p.enabled,
});

function isUnique(e: unknown): boolean {
  return e instanceof Error && /UNIQUE/i.test(e.message);
}

export const promoOps = {
  list(session: StaffSession | null, opts: Opts = {}): PromoRow[] {
    requirePermission(session, 'catalog.read');
    return promosRepo.list(opts.db ?? getDb());
  },

  create(session: StaffSession | null, input: unknown, opts: Opts = {}): PromoRow {
    requirePermission(session, 'promos.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const data = parsePromo(input);
    return withTransaction(db, () => {
      let id: number;
      try {
        id = promosRepo.insert(db, data, now);
      } catch (e) {
        if (isUnique(e)) throw new ConflictError('Промокод с таким кодом уже есть');
        throw e;
      }
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'promo.create', entity: 'promo', entityId: id, after: promoSnapshot(data) }, { db, now });
      return promosRepo.findById(db, id)!;
    });
  },

  update(session: StaffSession | null, id: number, input: unknown, opts: Opts = {}): PromoRow {
    requirePermission(session, 'promos.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const data = parsePromo(input);
    return withTransaction(db, () => {
      const before = promosRepo.findById(db, id);
      if (!before) throw new NotFoundError('Промокод не найден');
      try {
        promosRepo.update(db, id, data, now);
      } catch (e) {
        if (isUnique(e)) throw new ConflictError('Промокод с таким кодом уже есть');
        throw e;
      }
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'promo.update', entity: 'promo', entityId: id, before: promoSnapshot(before), after: promoSnapshot(data) },
        { db, now },
      );
      return promosRepo.findById(db, id)!;
    });
  },

  /** Использованный промокод удалить нельзя (история заказов): его выключают. */
  remove(session: StaffSession | null, id: number, opts: Opts = {}): void {
    requirePermission(session, 'promos.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const before = promosRepo.findById(db, id);
      if (!before) throw new NotFoundError('Промокод не найден');
      if (before.usedCount > 0) throw new ConflictError('Промокод уже использован в заказах — выключите его вместо удаления');
      promosRepo.delete(db, id);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'promo.delete', entity: 'promo', entityId: id, before: promoSnapshot(before) }, { db, now });
    });
  },
};
