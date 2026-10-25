import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { maskEmail, maskPhone } from '@/domain/admin/mask';
import { hasPermission, requirePermission, type Permission, type StaffSession } from '@/domain/admin/permissions';
import { getShopInfo } from '@/domain/content/settings';
import { normalizePromoCode } from '@/domain/pricing';
import { parseRubles } from '@/domain/pricing/format';
import { getPaymentPort } from '@/integrations/payment/select';
import { placeholder } from '@/ui/placeholder';
import { getDb, withTransaction } from '@/server/db/connection';
import { ORDER_SORT_KEYS, ordersRepo, type OrderListFilter, type OrderRow, type OrderSortKey, type OrderStatus } from '@/server/db/repositories/orders';
import { paymentsRepo } from '@/server/db/repositories/payments';
import { promosRepo, type PromoRow, type PromoWrite } from '@/server/db/repositories/promos';
import { staffRepo } from '@/server/db/repositories/staff';
import { ConflictError, NotFoundError, ValidationError, type FieldErrors } from '@/server/http/errors';
import { editItems, markPaidManually, updateDetails, type ItemsInput, type OrderDetailsPatch } from './order-edit';
import { orders } from './orders';
import { isOrderStatus, STATUS_LABELS } from './status';
import type { Actor, Opts, Order, OrderEvent } from './types';

/**
 * Операции админки над заказами и промокодами. Каждая САМА проверяет право (requirePermission) —
 * server actions и страницы вызывают их, получив сессию через requireStaff; обойти проверку нельзя.
 * Матрица (spec): заказы — orders.read/orders.write (admin, manager); промокоды — просмотр catalog.read,
 * запись promos.write (только admin); возврат средств — только admin (право settings.write).
 */
export const REFUND_PERMISSION: Permission = 'orders.refund';
export const ORDERS_PAGE_SIZES = [20, 50, 100] as const;
export const ORDERS_PAGE_SIZE = 20;
/** Предел экспорта: защита от выгрузки «всего и сразу» по ошибке. */
export const ORDERS_EXPORT_LIMIT = 10_000;

const actorOf = (s: StaffSession): Actor => ({ type: 'staff', staffId: s.staffId, role: s.role, permissions: s.permissions });

export type OrderFilters = {
  q?: string;
  status?: OrderStatus;
  /** Оплачен или нет (флаг is_paid). */
  paymentState?: 'paid' | 'unpaid';
  /** Способ получения (код) и способ оплаты (код). */
  deliveryCode?: string;
  paymentCode?: string;
  /** Сумма заказа, копейки. */
  minTotalKopecks?: number;
  maxTotalKopecks?: number;
  from?: number;
  to?: number;
  assignedStaffId?: number | 'none';
  sort?: OrderSortKey;
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
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
const CODE_RE = /^[a-z0-9_-]{1,40}$/;

/** Фильтры из адресной строки: всё лишнее и неверное молча отбрасывается. */
export function parseOrderFilters(sp: Record<string, unknown>): OrderFilters {
  const out: OrderFilters = {};
  const q = first(sp.q);
  if (typeof q === 'string' && q.trim() !== '') out.q = q.trim().slice(0, 100);
  const status = first(sp.status);
  if (isOrderStatus(status)) out.status = status;
  const pay = first(sp.pay);
  if (pay === 'paid' || pay === 'unpaid') out.paymentState = pay;
  const delivery = first(sp.delivery);
  if (typeof delivery === 'string' && CODE_RE.test(delivery)) out.deliveryCode = delivery;
  const method = first(sp.method);
  if (typeof method === 'string' && CODE_RE.test(method)) out.paymentCode = method;
  for (const [key, field] of [['min', 'minTotalKopecks'], ['max', 'maxTotalKopecks']] as const) {
    const raw = first(sp[key]);
    const kop = typeof raw === 'string' && raw.trim() !== '' ? parseRubles(raw.trim()) : null;
    if (kop !== null && kop <= 100_000_000_00) out[field] = kop;
  }
  const from = moscowDayStart(first(sp.from));
  if (from !== undefined) out.from = from;
  const toStart = moscowDayStart(first(sp.to));
  if (toStart !== undefined) out.to = toStart + 86_400_000; // «по» включает весь день
  const as = first(sp.assigned);
  if (as === 'none') out.assignedStaffId = 'none';
  else if (typeof as === 'string' && /^\d{1,9}$/.test(as)) out.assignedStaffId = Number(as);
  const sort = first(sp.sort);
  if (typeof sort === 'string' && (ORDER_SORT_KEYS as readonly string[]).includes(sort)) out.sort = sort as OrderSortKey;
  const dir = first(sp.dir);
  if (dir === 'asc' || dir === 'desc') out.dir = dir;
  const size = Number(first(sp.pageSize));
  if ((ORDERS_PAGE_SIZES as readonly number[]).includes(size)) out.pageSize = size;
  const page = Number(first(sp.page));
  out.page = Number.isInteger(page) && page >= 1 ? page : 1;
  return out;
}

/**
 * Роли, которые только читают заказы (например, склад: orders.read без orders.write и customers.read), видят контакты
 * покупателя замаскированными: сборка заказа не требует телефона и почты. Остальные видят всё.
 */
export const canSeeContacts = (s: StaffSession): boolean => hasPermission(s, 'orders.write') || hasPermission(s, 'customers.read');
const maskRow = (o: OrderRow): OrderRow => ({ ...o, contactPhone: maskPhone(o.contactPhone), contactEmail: maskEmail(o.contactEmail) });
const maskOrder = (o: Order): Order => ({ ...o, contact: { ...o.contact, phone: maskPhone(o.contact.phone), email: maskEmail(o.contact.email) } });

export type OrderListResult = { rows: OrderRow[]; total: number; page: number; pageSize: number };

const toRepoFilter = (f: OrderFilters): OrderListFilter => ({
  q: f.q,
  status: f.status,
  paymentState: f.paymentState,
  deliveryCode: f.deliveryCode,
  paymentCode: f.paymentCode,
  minTotalKopecks: f.minTotalKopecks,
  maxTotalKopecks: f.maxTotalKopecks,
  from: f.from,
  to: f.to,
  assignedStaffId: f.assignedStaffId,
  sort: f.sort,
  dir: f.dir,
});

/** Копейки → «1234,50» без плавающей точки (для CSV). */
const rubles = (kopecks: number): string => `${Math.trunc(kopecks / 100)},${String(Math.abs(kopecks) % 100).padStart(2, '0')}`;

/** Ячейка CSV: кавычки удваиваются; значения, похожие на формулу, обезврежены апострофом (защита от инъекции формул в Excel). */
function csvCell(v: string | number | null): string {
  let t = v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export type PaymentInfo = {
  isPaid: boolean;
  paymentName: string;
  paymentKind: string;
  /** Есть платёж через провайдера (успешный). */
  hasProviderPayment: boolean;
  provider: string;
  providerConnected: boolean;
  providerNote: string | null;
  refundAvailable: boolean;
  refundNote: string;
};

export type PrintData = {
  order: Order;
  shop: { name: string; requisites: string; address: string; phone: string };
};

export const orderOps = {
  list(session: StaffSession | null, filters: OrderFilters, opts: Opts = {}): OrderListResult {
    requirePermission(session, 'orders.read');
    const db = opts.db ?? getDb();
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = (ORDERS_PAGE_SIZES as readonly number[]).includes(filters.pageSize ?? 0) ? (filters.pageSize as number) : ORDERS_PAGE_SIZE;
    const { rows, total } = ordersRepo.list(db, { ...toRepoFilter(filters), limit: pageSize, offset: (page - 1) * pageSize });
    return { rows: canSeeContacts(session) ? rows : rows.map(maskRow), total, page, pageSize };
  },

  /** CSV (разделитель «;», UTF-8 с BOM) отфильтрованных заказов. Нужны orders.read и export.run; выгрузка пишется в аудит. */
  exportCsv(session: StaffSession | null, filters: OrderFilters, opts: Opts = {}): string {
    requirePermission(session, 'orders.read');
    requirePermission(session, 'export.run');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const staff = new Map(staffRepo.list(db).map((s) => [s.id, s.name ?? s.email]));
    const header = ['Номер', 'Дата', 'Статус', 'Оплата', 'Покупатель', 'Телефон', 'Email', 'Получение', 'Адрес', 'Способ оплаты', 'Товаров, шт.', 'Товары, руб.', 'Скидка, руб.', 'Доставка, руб.', 'Итого, руб.', 'Ответственный'];
    const lines: string[] = [header.map(csvCell).join(';')];
    const see = canSeeContacts(session);
    let exported = 0;
    for (let offset = 0; offset < ORDERS_EXPORT_LIMIT; offset += 200) {
      const { rows } = ordersRepo.list(db, { ...toRepoFilter(filters), limit: 200, offset });
      if (rows.length === 0) break;
      for (const o of rows) {
        const qty = ordersRepo.listItems(db, o.id).reduce((n, i) => n + i.qty, 0);
        lines.push(
          [
            o.number,
            new Date(o.createdAt).toISOString(),
            STATUS_LABELS[o.status],
            o.isPaid ? 'оплачен' : 'не оплачен',
            o.contactName,
            see ? o.contactPhone : maskPhone(o.contactPhone),
            see ? o.contactEmail : maskEmail(o.contactEmail),
            o.deliveryName,
            o.address,
            o.paymentName,
            qty,
            rubles(o.subtotalKopecks),
            rubles(o.discountKopecks),
            o.deliveryKopecks === null ? 'рассчитает менеджер' : rubles(o.deliveryKopecks),
            rubles(o.totalKopecks),
            o.assignedStaffId ? (staff.get(o.assignedStaffId) ?? `№${o.assignedStaffId}`) : '',
          ]
            .map(csvCell)
            .join(';'),
        );
        exported += 1;
      }
      if (rows.length < 200) break;
    }
    audit.record(
      { actorId: session.staffId, actorType: 'staff', action: 'order.export', entity: 'order', after: { rows: exported, status: filters.status, paymentState: filters.paymentState } },
      { db, now },
    );
    return `﻿${lines.join('\r\n')}\r\n`;
  },

  get(session: StaffSession | null, number: string, opts: Opts = {}): Order | null {
    requirePermission(session, 'orders.read');
    const o = orders.getForStaff(number, opts);
    return o && !canSeeContacts(session) ? maskOrder(o) : o;
  },

  history(session: StaffSession | null, orderId: number, opts: Opts = {}): OrderEvent[] {
    requirePermission(session, 'orders.read');
    return orders.events(orderId, opts);
  },

  /** Внутренние комментарии (не видны покупателю). */
  comments(session: StaffSession | null, orderId: number, opts: Opts = {}): Array<{ id: number; authorName: string | null; body: string; createdAt: number }> {
    requirePermission(session, 'orders.read');
    const db = opts.db ?? getDb();
    if (!ordersRepo.findById(db, orderId)) throw new NotFoundError('Заказ не найден');
    return ordersRepo.listComments(db, orderId).map((c) => ({ id: c.id, authorName: c.authorName, body: c.body, createdAt: c.createdAt }));
  },

  /** Состояние оплаты и возврата: честно показывает, подключён ли платёжный провайдер. */
  paymentInfo(session: StaffSession | null, orderId: number, opts: Opts & { production?: boolean } = {}): PaymentInfo {
    requirePermission(session, 'orders.read');
    const db = opts.db ?? getDb();
    const row = ordersRepo.findById(db, orderId);
    if (!row) throw new NotFoundError('Заказ не найден');
    const port = getPaymentPort({ production: opts.production });
    const status = port.status();
    const providerConnected = port.name !== 'none';
    const paid = paymentsRepo.findPaidForOrder(db, orderId);
    const refundAvailable = row.isPaid && paid !== null && providerConnected && row.status !== 'refunded';
    let refundNote: string;
    if (!providerConnected) refundNote = 'Платёжный провайдер не подключён: возврат средств через систему недоступен.';
    else if (!row.isPaid) refundNote = 'Заказ не оплачен — возвращать нечего.';
    else if (paid === null) refundNote = 'Оплата прошла вне платёжной системы (наличные, терминал): возврат оформляется вручную вне сайта.';
    else if (row.status === 'refunded') refundNote = 'Деньги уже возвращены.';
    else refundNote = status.connected ? 'Возврат пройдёт через платёжную систему.' : 'Подключён тестовый провайдер: деньги реально не возвращаются.';
    return {
      isPaid: row.isPaid,
      paymentName: row.paymentName,
      paymentKind: row.paymentKind,
      hasProviderPayment: paid !== null,
      provider: port.name,
      providerConnected,
      providerNote: status.note ?? null,
      refundAvailable,
      refundNote,
    };
  },

  /** Данные для страницы печати: реквизиты магазина — из настроек, иначе видимые метки (ничего не выдумываем). */
  printData(session: StaffSession | null, number: string, opts: Opts = {}): PrintData | null {
    requirePermission(session, 'orders.read');
    const order = orders.getForStaff(number, opts);
    if (!order) return null;
    const info = getShopInfo({ db: opts.db });
    return {
      order: canSeeContacts(session) ? order : maskOrder(order),
      shop: {
        name: info.siteName,
        requisites: info.requisites ?? placeholder('РЕКВИЗИТЫ'),
        address: info.address ?? placeholder('АДРЕС'),
        phone: info.phone ?? placeholder('ТЕЛЕФОН'),
      },
    };
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

  /** Возврат на предыдущий шаг по явной таблице; причина обязательна; «Выполнен»/«Отменён» — только orders.refund. */
  async revert(session: StaffSession | null, orderId: number, to: OrderStatus, reason: string | undefined, opts: Opts = {}): Promise<Order> {
    requirePermission(session, 'orders.write');
    return orders.transition(orderId, to, actorOf(session), reason, { ...opts, viaRefund: false, revert: true });
  },

  /** Отмена (admin и manager). Оплаченный заказ отменить нельзя — возврат. */
  async cancel(session: StaffSession | null, orderId: number, reason: string | undefined, opts: Opts = {}): Promise<Order> {
    requirePermission(session, 'orders.write');
    return orders.transition(orderId, 'cancelled', actorOf(session), reason, { ...opts, viaRefund: false });
  },

  /** Возврат оплаченного — только право orders.refund; без подключённого провайдера возврат невозможен. */
  async refund(session: StaffSession | null, orderId: number, note: string | undefined, opts: Opts = {}): Promise<Order> {
    requirePermission(session, REFUND_PERMISSION);
    return orders.refund(orderId, actorOf(session), note, { ...opts, viaRefund: false });
  },

  /** «Отметить оплаченным» (оплата при получении / вне системы): orders.write + подтверждение + комментарий. */
  async markPaid(session: StaffSession | null, orderId: number, input: { comment: string; confirm: boolean }, opts: Opts = {}): Promise<Order> {
    requirePermission(session, 'orders.write');
    return markPaidManually(orderId, input, actorOf(session), opts);
  },

  async updateDetails(session: StaffSession | null, orderId: number, patch: OrderDetailsPatch, opts: Opts = {}): Promise<Order> {
    requirePermission(session, 'orders.write');
    return updateDetails(orderId, patch, actorOf(session), opts);
  },

  async editItems(session: StaffSession | null, orderId: number, input: ItemsInput, opts: Opts = {}): Promise<Order> {
    requirePermission(session, 'orders.write');
    return editItems(orderId, input, actorOf(session), opts);
  },

  assign(session: StaffSession | null, orderId: number, staffId: number | null, opts: Opts = {}): Order {
    requirePermission(session, 'orders.write');
    return orders.assign(orderId, staffId, actorOf(session), opts);
  },

  addNote(session: StaffSession | null, orderId: number, text: string, opts: Opts = {}): void {
    requirePermission(session, 'orders.write');
    orders.addNote(orderId, text, actorOf(session), opts);
  },

  /** Внутренний комментарий (то же, что addNote): отдельная запись с автором и временем. */
  addComment(session: StaffSession | null, orderId: number, text: string, opts: Opts = {}): void {
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
    /** C08: купон не действует на позиции по акции и со скидкой. */
    excludeOnSale: z.boolean().optional(),
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
  excludeOnSale: p.excludeOnSale ?? false,
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
