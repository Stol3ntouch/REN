import { moscowDayStart } from '@/domain/ordering/admin-ops';

const DAY_MS = 86_400_000;
const MSK_MS = 3 * 3600_000;

/** Период Обзора: [from, to) в unix-мс, границы суток по Москве; fromStr/toStr — даты YYYY-MM-DD, «по» включительно. */
export type DashboardRange = { from: number; to: number; fromStr: string; toStr: string };
export const PERIOD_PRESETS = ['today', '7d', '30d', 'month', 'custom'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export const PERIOD_LABELS: Record<PeriodPreset, string> = { today: 'Сегодня', '7d': '7 дней', '30d': '30 дней', month: 'Этот месяц', custom: 'Свой диапазон' };

const mskDate = (ms: number): string => new Date(ms + MSK_MS).toISOString().slice(0, 10);
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

function rangeOf(fromMs: number, toExclusiveMs: number): DashboardRange {
  return { from: fromMs, to: toExclusiveMs, fromStr: mskDate(fromMs), toStr: mskDate(toExclusiveMs - 1) };
}

/**
 * Период из адресной строки: ?period=today|7d|30d|month или ?from=&to= (свой диапазон, «по» включительно).
 * Неверное или отсутствующее → последние 30 дней. Все границы — московские сутки.
 */
export function parseDashboardPeriod(sp: Record<string, unknown>, now: number = Date.now()): { preset: PeriodPreset; range: DashboardRange } {
  const today = moscowDayStart(mskDate(now))!;
  const preset = first(sp.period);
  if (preset === 'today') return { preset, range: rangeOf(today, today + DAY_MS) };
  if (preset === '7d') return { preset, range: rangeOf(today - 6 * DAY_MS, today + DAY_MS) };
  if (preset === 'month') {
    const [y, m] = mskDate(now).split('-').map(Number) as [number, number];
    const pad = (n: number) => String(n).padStart(2, '0');
    const start = moscowDayStart(`${y}-${pad(m)}-01`)!;
    const next = moscowDayStart(m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`)!;
    return { preset, range: rangeOf(start, next) };
  }
  const from = moscowDayStart(first(sp.from));
  const to = moscowDayStart(first(sp.to));
  if (preset !== '30d' && from !== undefined && to !== undefined && from <= to && to - from <= 800 * DAY_MS) {
    return { preset: 'custom', range: rangeOf(from, to + DAY_MS) };
  }
  return { preset: '30d', range: rangeOf(today - 29 * DAY_MS, today + DAY_MS) };
}
