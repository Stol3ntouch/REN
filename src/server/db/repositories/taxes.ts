import type { Db } from '../connection';

export type TaxRateRow = {
  id: number;
  name: string;
  /** Сотые доли процента: 2000 = 20 %. */
  rateBp: number;
  includedInPrice: boolean;
  isDefault: boolean;
  active: boolean;
  sort: number;
  createdAt: number;
};

type Raw = { id: number; name: string; rate_bp: number; included_in_price: number; is_default: number; active: number; sort: number; created_at: number };

const map = (r: Raw): TaxRateRow => ({
  id: r.id,
  name: r.name,
  rateBp: r.rate_bp,
  includedInPrice: r.included_in_price === 1,
  isDefault: r.is_default === 1,
  active: r.active === 1,
  sort: r.sort,
  createdAt: r.created_at,
});

export type TaxRateWrite = { name: string; rateBp: number; includedInPrice: boolean; active: boolean; sort: number };

export const taxesRepo = {
  list(db: Db): TaxRateRow[] {
    return (db.prepare('SELECT * FROM tax_rates ORDER BY sort, id').all() as Raw[]).map(map);
  },
  find(db: Db, id: number): TaxRateRow | null {
    const r = db.prepare('SELECT * FROM tax_rates WHERE id = ?').get(id) as Raw | undefined;
    return r ? map(r) : null;
  },
  /** Ставка, которая применяется к заказам: по умолчанию и действующая. */
  findApplicable(db: Db): TaxRateRow | null {
    const r = db.prepare('SELECT * FROM tax_rates WHERE is_default = 1 AND active = 1').get() as Raw | undefined;
    return r ? map(r) : null;
  },
  insert(db: Db, w: TaxRateWrite, now: number): number {
    const r = db
      .prepare('INSERT INTO tax_rates (name, rate_bp, included_in_price, is_default, active, sort, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)')
      .run(w.name, w.rateBp, w.includedInPrice ? 1 : 0, w.active ? 1 : 0, w.sort, now);
    return Number(r.lastInsertRowid);
  },
  update(db: Db, id: number, w: TaxRateWrite): boolean {
    return Number(db.prepare('UPDATE tax_rates SET name = ?, rate_bp = ?, included_in_price = ?, active = ?, sort = ? WHERE id = ?').run(w.name, w.rateBp, w.includedInPrice ? 1 : 0, w.active ? 1 : 0, w.sort, id).changes) > 0;
  },
  /** Одна ставка по умолчанию; null снимает назначение. */
  setDefault(db: Db, id: number | null): void {
    db.prepare('UPDATE tax_rates SET is_default = 0 WHERE is_default = 1').run();
    if (id !== null) db.prepare('UPDATE tax_rates SET is_default = 1 WHERE id = ?').run(id);
  },
  delete(db: Db, id: number): boolean {
    return Number(db.prepare('DELETE FROM tax_rates WHERE id = ?').run(id).changes) > 0;
  },
};
