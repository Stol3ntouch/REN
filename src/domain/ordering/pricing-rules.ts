import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { orderCharges, type ChargeRules, type OrderCharges } from '@/domain/pricing/charges';
import { DEFAULT_ROUNDING, ROUNDING_RULES, ROUNDING_STEPS, type Rounding } from '@/domain/pricing/money';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import type { PaymentMethodRow } from '@/server/db/repositories/methods';
import { settingsRepo } from '@/server/db/repositories/settings';
import { taxesRepo, type TaxRateRow } from '@/server/db/repositories/taxes';
import { ConflictError, NotFoundError, ValidationError } from '@/server/http/errors';

/**
 * Налоги и правила округления (C12, ADR-016). Настройки лежат в shop_settings, ставки — в tax_rates.
 * Ставок по умолчанию нет: пока владелец не заведёт ставку, налог в заказах равен нулю и итоги совпадают с прежними.
 */

export const PRICING_KEYS = {
  rule: 'pricing_rounding',
  step: 'pricing_rounding_step',
  includesTax: 'pricing_includes_tax',
} as const;

export type PricingSettings = { rounding: Rounding; /** Все ставки считаются включёнными в цену. */ pricesIncludeTax: boolean };

type Opts = { db?: Db; now?: number };

export function readPricingSettings(db: Db): PricingSettings {
  const rule = settingsRepo.get(db, PRICING_KEYS.rule);
  const step = settingsRepo.get(db, PRICING_KEYS.step);
  return {
    rounding: {
      rule: (ROUNDING_RULES as readonly string[]).includes(rule ?? '') ? (rule as Rounding['rule']) : DEFAULT_ROUNDING.rule,
      step: (ROUNDING_STEPS as readonly string[]).includes(step ?? '') ? (step as Rounding['step']) : DEFAULT_ROUNDING.step,
    },
    pricesIncludeTax: settingsRepo.get(db, PRICING_KEYS.includesTax) === '1',
  };
}

/** Правило налога, которое применяется к новым заказам: ставка по умолчанию (если действует). */
export function activeTaxRule(db: Db): ChargeRules['tax'] {
  const rate = taxesRepo.findApplicable(db);
  if (!rate || rate.rateBp === 0) return null;
  return { rateBp: rate.rateBp, included: readPricingSettings(db).pricesIncludeTax || rate.includedInPrice };
}

/** Полные правила надбавок для нового заказа с этим способом оплаты. */
export function chargeRulesFor(db: Db, payment: Pick<PaymentMethodRow, 'feePercentBp' | 'feeFixedKopecks'>): ChargeRules {
  return {
    fee: { percentBp: payment.feePercentBp, fixedKopecks: payment.feeFixedKopecks },
    tax: activeTaxRule(db),
    rounding: readPricingSettings(db).rounding,
  };
}

/** Снимок правил, сохраняемый в заказе: правка состава заказа пересчитывается по ним, а не по сегодняшним настройкам. */
export function serializeRules(rules: ChargeRules): string {
  return JSON.stringify({
    feePercentBp: rules.fee.percentBp,
    feeFixedKopecks: rules.fee.fixedKopecks,
    taxRateBp: rules.tax?.rateBp ?? null,
    taxIncluded: rules.tax?.included ?? false,
    rule: rules.rounding.rule,
    step: rules.rounding.step,
  });
}

const snapshotSchema = z.object({
  feePercentBp: z.number().int().min(0),
  feeFixedKopecks: z.number().int().min(0),
  taxRateBp: z.number().int().min(0).nullable(),
  taxIncluded: z.boolean(),
  rule: z.enum(['none', 'down', 'up', 'nearest']),
  step: z.enum(['kopeck', 'ruble']),
});

/** Правила из снимка заказа; у заказов, оформленных до C12 (снимка нет), надбавок нет. */
export function parseRules(json: string | null): ChargeRules {
  const none: ChargeRules = { fee: { percentBp: 0, fixedKopecks: 0 }, tax: null, rounding: { ...DEFAULT_ROUNDING } };
  if (!json) return none;
  try {
    const p = snapshotSchema.safeParse(JSON.parse(json));
    if (!p.success) return none;
    const v = p.data;
    return {
      fee: { percentBp: v.feePercentBp, fixedKopecks: v.feeFixedKopecks },
      tax: v.taxRateBp !== null && v.taxRateBp > 0 ? { rateBp: v.taxRateBp, included: v.taxIncluded } : null,
      rounding: { rule: v.rule, step: v.step },
    };
  } catch {
    return none;
  }
}

/** Пересчёт надбавок заказа по сохранённому снимку (правка состава). */
export function recalcCharges(rulesJson: string | null, input: { lines: readonly number[]; discountKopecks: number; deliveryKopecks: number | null }): OrderCharges & { rules: ChargeRules } {
  const rules = parseRules(rulesJson);
  return { ...orderCharges({ ...input, rules }), rules };
}

// ---------------------------------------------------------------- администрирование (settings.write)

const settingsSchema = z.object({
  rule: z.enum(['none', 'down', 'up', 'nearest'], { error: 'Неизвестное правило округления' }),
  step: z.enum(['kopeck', 'ruble'], { error: 'Округление: до копейки или до рубля' }),
  pricesIncludeTax: z.boolean(),
});

const rateSchema = z.object({
  name: z.string().trim().min(2, 'Название: не короче 2 знаков').max(80, 'Название: не длиннее 80 знаков'),
  rateBp: z.number().int('Ставка — целое число сотых долей процента').min(0, 'Ставка не может быть отрицательной').max(10_000, 'Ставка не больше 100 %'),
  includedInPrice: z.boolean(),
  active: z.boolean(),
  sort: z.number().int().min(0).max(9999).default(0),
});

function fail(issues: { message: string; path: PropertyKey[] }[]): never {
  const fields: Record<string, string[]> = {};
  for (const i of issues) (fields[String(i.path[0] ?? 'form')] ??= []).push(i.message);
  throw new ValidationError(issues[0]?.message ?? 'Проверьте поля формы', fields);
}

const rateAudit = (r: TaxRateRow) => ({ name: r.name, rateBp: r.rateBp, includedInPrice: r.includedInPrice, active: r.active, isDefault: r.isDefault });

export const taxesAdmin = {
  view(session: StaffSession | null, opts: Opts = {}): { settings: PricingSettings; rates: TaxRateRow[] } {
    requirePermission(session, 'settings.write');
    const db = opts.db ?? getDb();
    return { settings: readPricingSettings(db), rates: taxesRepo.list(db) };
  },

  saveSettings(session: StaffSession | null, input: unknown, opts: Opts = {}): void {
    requirePermission(session, 'settings.write');
    const p = settingsSchema.safeParse(input);
    if (!p.success) fail(p.error.issues);
    const v = p.data;
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const before = readPricingSettings(db);
      settingsRepo.set(db, PRICING_KEYS.rule, v.rule, now);
      settingsRepo.set(db, PRICING_KEYS.step, v.step, now);
      settingsRepo.set(db, PRICING_KEYS.includesTax, v.pricesIncludeTax ? '1' : '0', now);
      audit.record(
        {
          actorId: session.staffId,
          actorType: 'staff',
          action: 'pricing.settings',
          entity: 'settings',
          entityId: 'pricing',
          before: { rule: before.rounding.rule, step: before.rounding.step, pricesIncludeTax: before.pricesIncludeTax },
          after: v,
        },
        { db, now },
      );
    });
  },

  createRate(session: StaffSession | null, input: unknown, opts: Opts = {}): number {
    requirePermission(session, 'settings.write');
    const p = rateSchema.safeParse(input);
    if (!p.success) fail(p.error.issues);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      const id = taxesRepo.insert(db, p.data, now);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'tax.create', entity: 'tax_rate', entityId: id, after: rateAudit(taxesRepo.find(db, id)!) }, { db, now });
      return id;
    });
  },

  updateRate(session: StaffSession | null, id: number, input: unknown, opts: Opts = {}): void {
    requirePermission(session, 'settings.write');
    const p = rateSchema.safeParse(input);
    if (!p.success) fail(p.error.issues);
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const before = taxesRepo.find(db, id);
      if (!before) throw new NotFoundError('Ставка не найдена');
      if (before.isDefault && !p.data.active) throw new ConflictError('Ставка по умолчанию должна быть действующей: назначьте другую или снимите назначение');
      taxesRepo.update(db, id, p.data);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'tax.update', entity: 'tax_rate', entityId: id, before: rateAudit(before), after: rateAudit(taxesRepo.find(db, id)!) }, { db, now });
    });
  },

  /** Назначает ставку, применяемую к новым заказам; null — налог не начисляется. */
  setDefault(session: StaffSession | null, id: number | null, opts: Opts = {}): void {
    requirePermission(session, 'settings.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      if (id !== null) {
        const r = taxesRepo.find(db, id);
        if (!r) throw new NotFoundError('Ставка не найдена');
        if (!r.active) throw new ConflictError('Назначить можно только действующую ставку');
      }
      const before = taxesRepo.list(db).find((r) => r.isDefault)?.id ?? null;
      taxesRepo.setDefault(db, id);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'tax.default', entity: 'tax_rate', entityId: id ?? 'none', before: { id: before }, after: { id } }, { db, now });
    });
  },

  removeRate(session: StaffSession | null, id: number, opts: Opts = {}): void {
    requirePermission(session, 'settings.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const r = taxesRepo.find(db, id);
      if (!r) throw new NotFoundError('Ставка не найдена');
      taxesRepo.delete(db, id);
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'tax.delete', entity: 'tax_rate', entityId: id, before: rateAudit(r) }, { db, now });
    });
  },
};
