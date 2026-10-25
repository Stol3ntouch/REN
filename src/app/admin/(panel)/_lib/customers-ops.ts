import { audit } from '@/domain/admin/audit';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import {
  CUSTOMER_SORT_KEYS,
  CUSTOMER_STATUSES,
  customersAdminRepo,
  type CustomerAddressRow,
  type CustomerConsentRow,
  type CustomerFilter,
  type CustomerNoteRow,
  type CustomerOrderRow,
  type CustomerRow,
  type CustomerStatus,
} from '@/server/db/repositories/customers-admin';
import { NotFoundError, ValidationError } from '@/server/http/errors';

type Opts = { db?: Db; now?: number };

export const CUSTOMER_STATUS_LABELS: Readonly<Record<CustomerStatus, string>> = { active: 'Активный', vip: 'VIP', blocked: 'Заблокирован' };
export const CUSTOMERS_PAGE_SIZES = [20, 50, 100] as const;
export const CUSTOMERS_EXPORT_LIMIT = 10_000;
const NOTE_MAX = 1000;

const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function dayStart(v: unknown): number | undefined {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return undefined;
  const t = Date.parse(`${v}T00:00:00+03:00`);
  return Number.isNaN(t) ? undefined : t;
}

/** Фильтры списка из адресной строки: лишнее молча отбрасывается. */
export function parseCustomerFilters(sp: Record<string, unknown>): CustomerFilter {
  const out: CustomerFilter = {};
  const q = first(sp.q);
  if (typeof q === 'string' && q.trim()) out.q = q.trim().slice(0, 100);
  const status = first(sp.status);
  if ((CUSTOMER_STATUSES as readonly string[]).includes(status as string)) out.status = status as CustomerStatus;
  const from = dayStart(first(sp.from));
  if (from !== undefined) out.from = from;
  const to = dayStart(first(sp.to));
  if (to !== undefined) out.to = to + 86_400_000;
  const orders = first(sp.orders);
  if (orders === 'yes') out.hasOrders = true;
  else if (orders === 'no') out.hasOrders = false;
  const sort = first(sp.sort);
  if ((CUSTOMER_SORT_KEYS as readonly string[]).includes(sort as string)) out.sort = sort as CustomerFilter['sort'];
  const dir = first(sp.dir);
  if (dir === 'asc' || dir === 'desc') out.dir = dir;
  const size = Number(first(sp.pageSize));
  if ((CUSTOMERS_PAGE_SIZES as readonly number[]).includes(size)) out.pageSize = size;
  const page = Number(first(sp.page));
  out.page = Number.isInteger(page) && page >= 1 ? page : 1;
  return out;
}

function csvCell(v: string | number | null): string {
  let t = v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}
const rubles = (k: number): string => `${Math.trunc(k / 100)},${String(Math.abs(k) % 100).padStart(2, '0')}`;

export type CustomerProfile = {
  user: CustomerRow;
  orders: CustomerOrderRow[];
  addresses: CustomerAddressRow[];
  consents: CustomerConsentRow[];
  notes: CustomerNoteRow[];
};

/** Клиенты: чтение — customers.read; смена статуса и заметки — customers.write. Пароли, токены и хеши сюда не попадают. */
export const customersOps = {
  list(session: StaffSession | null, f: CustomerFilter, opts: Opts = {}) {
    requirePermission(session, 'customers.read');
    return customersAdminRepo.list(opts.db ?? getDb(), f);
  },

  get(session: StaffSession | null, id: number, opts: Opts = {}): CustomerProfile | null {
    requirePermission(session, 'customers.read');
    const db = opts.db ?? getDb();
    const user = customersAdminRepo.findById(db, id);
    if (!user) return null;
    return {
      user,
      orders: customersAdminRepo.orders(db, id),
      addresses: customersAdminRepo.addresses(db, id),
      consents: customersAdminRepo.consents(db, id),
      notes: customersAdminRepo.notes(db, id),
    };
  },

  /** Статус клиента. blocked закрывает вход, оформление заказа и текущие сессии. Аудит без контактов. */
  setStatus(session: StaffSession | null, id: number, status: unknown, opts: Opts = {}): CustomerRow {
    requirePermission(session, 'customers.write');
    if (!(CUSTOMER_STATUSES as readonly string[]).includes(status as string)) throw new ValidationError('Выберите статус клиента из списка');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      const before = customersAdminRepo.findById(db, id);
      if (!before) throw new NotFoundError('Клиент не найден');
      const next = status as CustomerStatus;
      if (before.status !== next) {
        customersAdminRepo.setStatus(db, id, next);
        if (next === 'blocked') customersAdminRepo.deleteSessions(db, id);
        audit.record({ actorId: session.staffId, actorType: 'staff', action: 'customer.status', entity: 'customer', entityId: id, before: { status: before.status }, after: { status: next } }, { db, now });
      }
      return customersAdminRepo.findById(db, id)!;
    });
  },

  /** Заметка менеджера: отдельная запись с автором и временем; клиенту не видна. */
  addNote(session: StaffSession | null, id: number, body: unknown, opts: Opts = {}): void {
    requirePermission(session, 'customers.write');
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) throw new ValidationError('Введите текст заметки');
    if (text.length > NOTE_MAX) throw new ValidationError(`Заметка не длиннее ${NOTE_MAX} символов`);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      if (!customersAdminRepo.findById(db, id)) throw new NotFoundError('Клиент не найден');
      const noteId = customersAdminRepo.insertNote(db, id, session.staffId, text, now);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'customer.note', entity: 'customer', entityId: id, after: { noteId, length: text.length } }, { db, now });
    });
  },

  /** CSV отфильтрованных клиентов: customers.read + export.run; пишется в аудит. */
  exportCsv(session: StaffSession | null, f: CustomerFilter, opts: Opts = {}): string {
    requirePermission(session, 'customers.read');
    requirePermission(session, 'export.run');
    const db = opts.db ?? getDb();
    const rows = customersAdminRepo.listAll(db, f, CUSTOMERS_EXPORT_LIMIT);
    const head = ['ID', 'Имя', 'Телефон', 'Email', 'Регистрация', 'Статус', 'Заказов', 'Сумма покупок, руб.'];
    const lines = [head.map(csvCell).join(';')];
    for (const r of rows) {
      lines.push([r.id, r.name, r.phone, r.email, new Date(r.createdAt).toISOString(), CUSTOMER_STATUS_LABELS[r.status], r.ordersCount, rubles(r.spentKopecks)].map(csvCell).join(';'));
    }
    audit.record({ actorId: session.staffId, actorType: 'staff', action: 'customer.export', entity: 'customer', after: { rows: rows.length } }, { db, now: opts.now ?? Date.now() });
    return `﻿${lines.join('\r\n')}\r\n`;
  },
};
