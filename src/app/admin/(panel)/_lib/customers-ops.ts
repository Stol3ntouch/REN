import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { getDb, type Db } from '@/server/db/connection';
import { customersAdminRepo, type CustomerOrderRow, type CustomerRow } from '@/server/db/repositories/customers-admin';

type Opts = { db?: Db };

/** Покупатели: просмотр контактов и заказов, право customers.read (admin и manager). Менеджер ничего не редактирует. */
export const customersOps = {
  list(session: StaffSession | null, f: { q?: string; page?: number }, opts: Opts = {}) {
    requirePermission(session, 'customers.read');
    return customersAdminRepo.list(opts.db ?? getDb(), f);
  },

  get(session: StaffSession | null, id: number, opts: Opts = {}): { user: CustomerRow; orders: CustomerOrderRow[] } | null {
    requirePermission(session, 'customers.read');
    const db = opts.db ?? getDb();
    const user = customersAdminRepo.findById(db, id);
    return user ? { user, orders: customersAdminRepo.orders(db, id) } : null;
  },
};
