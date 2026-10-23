import { hasPermission, type StaffSession } from '@/domain/admin/permissions';
import { integrationAttention, newRequests, overview, type Bucket, type IntegrationAttention, type NewRequests, type Period } from '@/domain/analytics';
import { UnauthorizedError } from '@/server/http/errors';
import { getDb, type Db } from '@/server/db/connection';

export type OverviewView = {
  empty: boolean;
  /** Число заказов видно всем, у кого есть orders.read. */
  orders: { counted: number; created: number } | null;
  /** Деньги — только analytics.read (admin). */
  money: { revenueKopecks: number; averageCheckKopecks: number | null; paidOrders: number } | null;
  series: { bucket: string; orders: number; revenueKopecks: number }[] | null;
  requests: NewRequests;
  /** Ошибки интеграций — для тех, у кого есть integrations.read. */
  attention: IntegrationAttention | null;
};

/** Обзор: каждый блок показывается по праву роли; того, на что нет права, в ответе нет вообще. */
export const overviewOps = {
  get(session: StaffSession | null, range: Period, by: Bucket, opts: { db?: Db; now?: number } = {}): OverviewView {
    if (!session) throw new UnauthorizedError('Требуется вход в админку');
    const o = overview(range, by, opts);
    const canOrders = hasPermission(session.role, 'orders.read');
    const canMoney = hasPermission(session.role, 'analytics.read');
    const canIntegrations = hasPermission(session.role, 'integrations.read');
    return {
      empty: o.empty,
      orders: canOrders ? { counted: o.summary.ordersCounted, created: o.summary.ordersCreated } : null,
      money: canMoney ? { revenueKopecks: o.summary.revenueKopecks, averageCheckKopecks: o.summary.averageCheckKopecks, paidOrders: o.summary.paidOrders } : null,
      series: canMoney ? o.series : null,
      requests: newRequests(opts.db ?? getDb()),
      attention: canIntegrations ? integrationAttention(opts) : null,
    };
  },
};

