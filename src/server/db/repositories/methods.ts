import type { Db } from '../connection';

export type DeliveryKind = 'pickup' | 'manual';
export type PaymentKind = 'cash_on_delivery' | 'online';

export type DeliveryMethodRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  kind: DeliveryKind;
  /** null — стоимость рассчитает менеджер. */
  priceKopecks: number | null;
  requiresAddress: boolean;
  enabled: boolean;
  sort: number;
};

export type PaymentMethodRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  kind: PaymentKind;
  testOnly: boolean;
  enabled: boolean;
  sort: number;
};

type RawDelivery = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  kind: DeliveryKind;
  price_kopecks: number | null;
  requires_address: number;
  enabled: number;
  sort: number;
};
type RawPayment = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  kind: PaymentKind;
  test_only: number;
  enabled: number;
  sort: number;
};

const mapDelivery = (r: RawDelivery | undefined): DeliveryMethodRow | null =>
  r
    ? {
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        kind: r.kind,
        priceKopecks: r.price_kopecks,
        requiresAddress: r.requires_address === 1,
        enabled: r.enabled === 1,
        sort: r.sort,
      }
    : null;

const mapPayment = (r: RawPayment | undefined): PaymentMethodRow | null =>
  r
    ? {
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        kind: r.kind,
        testOnly: r.test_only === 1,
        enabled: r.enabled === 1,
        sort: r.sort,
      }
    : null;

export const methodsRepo = {
  listDelivery(db: Db, opts: { enabledOnly?: boolean } = {}): DeliveryMethodRow[] {
    const sql = `SELECT * FROM delivery_methods ${opts.enabledOnly ? 'WHERE enabled = 1' : ''} ORDER BY sort, id`;
    return (db.prepare(sql).all() as RawDelivery[]).map((r) => mapDelivery(r)!);
  },
  findDelivery(db: Db, id: number): DeliveryMethodRow | null {
    return mapDelivery(db.prepare('SELECT * FROM delivery_methods WHERE id = ?').get(id) as RawDelivery | undefined);
  },
  listPayment(db: Db, opts: { enabledOnly?: boolean } = {}): PaymentMethodRow[] {
    const sql = `SELECT * FROM payment_methods ${opts.enabledOnly ? 'WHERE enabled = 1' : ''} ORDER BY sort, id`;
    return (db.prepare(sql).all() as RawPayment[]).map((r) => mapPayment(r)!);
  },
  findPayment(db: Db, id: number): PaymentMethodRow | null {
    return mapPayment(db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(id) as RawPayment | undefined);
  },
  findPaymentByCode(db: Db, code: string): PaymentMethodRow | null {
    return mapPayment(db.prepare('SELECT * FROM payment_methods WHERE code = ?').get(code) as RawPayment | undefined);
  },
  setPaymentEnabled(db: Db, code: string, enabled: boolean): boolean {
    return Number(db.prepare('UPDATE payment_methods SET enabled = ? WHERE code = ?').run(enabled ? 1 : 0, code).changes) > 0;
  },
  setDeliveryEnabled(db: Db, code: string, enabled: boolean): boolean {
    return Number(db.prepare('UPDATE delivery_methods SET enabled = ? WHERE code = ?').run(enabled ? 1 : 0, code).changes) > 0;
  },
  /** Заводит «онлайн (ТЕСТ)» выключенным; существующую строку не трогает. Вызывающий не вызывает это в production. */
  insertOnlineTestIfMissing(db: Db): void {
    db.prepare(
      `INSERT OR IGNORE INTO payment_methods (code, name, description, kind, test_only, enabled, sort)
       VALUES ('online_test', 'Онлайн (ТЕСТ)', 'Тестовая оплата: деньги не списываются.', 'online', 1, 0, 90)`,
    ).run();
  },
};
