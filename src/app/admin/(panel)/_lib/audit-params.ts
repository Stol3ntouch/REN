import type { AuditListFilter } from './audit-ops';

type Sp = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();

const DAY_MS = 24 * 60 * 60 * 1000;

/** Начало дня YYYY-MM-DD по Москве (UTC+3, без перехода на летнее время) в unix-мс; неверная дата → undefined. */
export function mskDayStart(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const t = Date.parse(`${value}T00:00:00+03:00`);
  return Number.isFinite(t) ? t : undefined;
}

/** Фильтр журнала из адреса: период «с–по» включает оба дня целиком (to — исключительно, следующая полночь). */
export function auditFilterFromParams(sp: Sp): AuditListFilter {
  const from = mskDayStart(one(sp.from));
  const toDay = mskDayStart(one(sp.to));
  return {
    actorId: one(sp.actor) || undefined,
    actionPrefix: one(sp.action) || undefined,
    entity: one(sp.entity) || undefined,
    entityId: one(sp.entityId) || undefined,
    result: one(sp.result) || undefined,
    from,
    to: toDay === undefined ? undefined : toDay + DAY_MS,
  };
}
