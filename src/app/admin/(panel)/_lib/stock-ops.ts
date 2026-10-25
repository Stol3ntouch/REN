import { audit } from '@/domain/admin/audit';
import { hasPermission, type Permission, type StaffSession } from '@/domain/admin/permissions';
import { stock, type StockChange, type StockMovementRow, type StockState } from '@/domain/catalog/stock';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { ForbiddenError, UnauthorizedError } from '@/server/http/errors';

type Opts = { db?: Db; now?: number };

const WRITE: readonly Permission[] = ['products.write', 'warehouses.write', 'catalog.write'];
const READ: readonly Permission[] = ['products.read', 'catalog.read', 'warehouses.write'];

function requireAny(session: StaffSession | null | undefined, perms: readonly Permission[]): asserts session is StaffSession {
  if (!session) throw new UnauthorizedError('Требуется вход в админку');
  if (!perms.some((p) => hasPermission(session, p))) throw new ForbiddenError('Недостаточно прав для этого действия');
}

/** Операции с остатком из админки: права, сервис stock (транзакция + история) и запись в журнал действий. */
export const stockOps = {
  adjust(session: StaffSession | null, productId: number, change: StockChange, reason: string, opts: Opts = {}): StockState {
    requireAny(session, WRITE);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      const before = stock.state(productId, { db });
      const res = stock.adjust(productId, change, reason, { staffId: session.staffId }, { db, now });
      if (res.changed) {
        audit.record(
          {
            actorId: session.staffId,
            actorType: 'staff',
            action: 'stock.adjust',
            entity: 'product',
            entityId: productId,
            before: before ? { stockQty: before.stockQty, reservedQty: before.reservedQty } : undefined,
            after: { stockQty: res.stockQty, reservedQty: res.reservedQty, reason: reason.trim() },
          },
          { db, now },
        );
      }
      return res;
    });
  },

  history(session: StaffSession | null, productId: number, opts: Opts = {}): StockMovementRow[] {
    requireAny(session, READ);
    return stock.history(productId, { db: opts.db ?? getDb() }, 100);
  },
};
