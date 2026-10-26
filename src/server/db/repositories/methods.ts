import type { Db } from '../connection';

export type DeliveryKind = 'pickup' | 'manual';
export type PaymentKind = 'cash_on_delivery' | 'online';
export type PaymentMode = 'test' | 'live';

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
  /** С какой суммы товаров (после скидки) доставка бесплатна; null — порога нет. */
  freeFromKopecks: number | null;
  /** Регионы и города обслуживания; null — вся страна. */
  regions: string[] | null;
  /** Срок доставки: текст вводит администратор («1–3 дня»), сайт его не выдумывает. */
  etaText: string | null;
  /** Минимальная сумма товаров (после скидки) для этого способа; 0 — без ограничения. */
  minOrderKopecks: number;
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
  /** Комиссия: процент в сотых долях (150 = 1,5 %) и фиксированная часть в копейках. */
  feePercentBp: number;
  feeFixedKopecks: number;
  minKopecks: number | null;
  maxKopecks: number | null;
  mode: PaymentMode;
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
  free_from_kopecks: number | null;
  regions_json: string | null;
  eta_text: string | null;
  min_order_kopecks: number;
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
  fee_percent_bp: number;
  fee_fixed_kopecks: number;
  min_kopecks: number | null;
  max_kopecks: number | null;
  mode: PaymentMode;
};

function parseRegions(json: string | null): string[] | null {
  if (json === null) return null;
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) return null;
    const list = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    return list.length > 0 ? list : null;
  } catch {
    return null;
  }
}

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
        freeFromKopecks: r.free_from_kopecks,
        regions: parseRegions(r.regions_json),
        etaText: r.eta_text,
        minOrderKopecks: r.min_order_kopecks,
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
        feePercentBp: r.fee_percent_bp,
        feeFixedKopecks: r.fee_fixed_kopecks,
        minKopecks: r.min_kopecks,
        maxKopecks: r.max_kopecks,
        mode: r.mode,
      }
    : null;

export type DeliveryWrite = {
  name: string;
  description: string | null;
  kind: DeliveryKind;
  priceKopecks: number | null;
  requiresAddress: boolean;
  enabled: boolean;
  sort: number;
  freeFromKopecks: number | null;
  regions: string[] | null;
  etaText: string | null;
  minOrderKopecks: number;
};

export type PaymentWrite = {
  name: string;
  description: string | null;
  enabled: boolean;
  sort: number;
  feePercentBp: number;
  feeFixedKopecks: number;
  minKopecks: number | null;
  maxKopecks: number | null;
  mode: PaymentMode;
};

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
      `INSERT OR IGNORE INTO payment_methods (code, name, description, kind, test_only, enabled, sort, mode)
       VALUES ('online_test', 'Онлайн (ТЕСТ)', 'Тестовая оплата: деньги не списываются.', 'online', 1, 0, 90, 'test')`,
    ).run();
  },

  // --- C12: администрирование ---
  insertDelivery(db: Db, w: DeliveryWrite): number {
    const code = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const r = db
      .prepare(
        `INSERT INTO delivery_methods (code, name, description, kind, price_kopecks, requires_address, enabled, sort, free_from_kopecks, regions_json, eta_text, min_order_kopecks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(code, w.name, w.description, w.kind, w.priceKopecks, w.requiresAddress ? 1 : 0, w.enabled ? 1 : 0, w.sort, w.freeFromKopecks, w.regions ? JSON.stringify(w.regions) : null, w.etaText, w.minOrderKopecks);
    return Number(r.lastInsertRowid);
  },
  updateDelivery(db: Db, id: number, w: DeliveryWrite): boolean {
    const r = db
      .prepare(
        `UPDATE delivery_methods SET name = ?, description = ?, kind = ?, price_kopecks = ?, requires_address = ?, enabled = ?, sort = ?,
           free_from_kopecks = ?, regions_json = ?, eta_text = ?, min_order_kopecks = ? WHERE id = ?`,
      )
      .run(w.name, w.description, w.kind, w.priceKopecks, w.requiresAddress ? 1 : 0, w.enabled ? 1 : 0, w.sort, w.freeFromKopecks, w.regions ? JSON.stringify(w.regions) : null, w.etaText, w.minOrderKopecks, id);
    return Number(r.changes) > 0;
  },
  countOrdersByDelivery(db: Db, id: number): number {
    return Number((db.prepare('SELECT COUNT(*) AS n FROM orders WHERE delivery_method_id = ?').get(id) as { n: number }).n);
  },
  deleteDelivery(db: Db, id: number): boolean {
    return Number(db.prepare('DELETE FROM delivery_methods WHERE id = ?').run(id).changes) > 0;
  },

  /** Новый способ оплаты — только «при получении»: онлайн-метод без провайдера создавать нельзя. */
  insertCashPayment(db: Db, w: PaymentWrite): number {
    const code = `cod${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const r = db
      .prepare(
        `INSERT INTO payment_methods (code, name, description, kind, test_only, enabled, sort, fee_percent_bp, fee_fixed_kopecks, min_kopecks, max_kopecks, mode)
         VALUES (?, ?, ?, 'cash_on_delivery', 0, ?, ?, ?, ?, ?, ?, 'live')`,
      )
      .run(code, w.name, w.description, w.enabled ? 1 : 0, w.sort, w.feePercentBp, w.feeFixedKopecks, w.minKopecks, w.maxKopecks);
    return Number(r.lastInsertRowid);
  },
  updatePayment(db: Db, id: number, w: PaymentWrite): boolean {
    const r = db
      .prepare(
        `UPDATE payment_methods SET name = ?, description = ?, enabled = ?, sort = ?, fee_percent_bp = ?, fee_fixed_kopecks = ?, min_kopecks = ?, max_kopecks = ?, mode = ? WHERE id = ?`,
      )
      .run(w.name, w.description, w.enabled ? 1 : 0, w.sort, w.feePercentBp, w.feeFixedKopecks, w.minKopecks, w.maxKopecks, w.mode, id);
    return Number(r.changes) > 0;
  },
  countOrdersByPayment(db: Db, id: number): number {
    return Number((db.prepare('SELECT COUNT(*) AS n FROM orders WHERE payment_method_id = ?').get(id) as { n: number }).n);
  },
  deletePayment(db: Db, id: number): boolean {
    return Number(db.prepare('DELETE FROM payment_methods WHERE id = ?').run(id).changes) > 0;
  },
};
