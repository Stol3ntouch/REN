export type ChartPoint = { bucket: string; revenueKopecks: number; orders: number };
export type ChartBar = { x: number; y: number; width: number; height: number; label: string; revenueKopecks: number; orders: number; showLabel: boolean };
export type ChartGeometry = { width: number; height: number; plotLeft: number; plotTop: number; plotBottom: number; plotRight: number; maxKopecks: number; ticks: { y: number; kopecks: number }[]; bars: ChartBar[] };

const W = 640;
const H = 240;
const LEFT = 64;
const RIGHT = 12;
const TOP = 12;
const BOTTOM = 32;

/** «Красивый» верх шкалы в копейках: 1, 2, 2.5, 5 × 10^n рублей; ноль → 100 ₽, чтобы шкала не схлопывалась. */
export function niceMax(kopecks: number): number {
  if (kopecks <= 0) return 10_000;
  const rubles = kopecks / 100;
  const pow = 10 ** Math.floor(Math.log10(rubles));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= rubles) return Math.round(m * pow * 100);
  return Math.round(10 * pow * 100);
}

/** Геометрия столбчатой диаграммы продаж: чистая функция по реальным агрегатам, без внешних библиотек. */
export function salesChartGeometry(points: readonly ChartPoint[]): ChartGeometry {
  const maxKopecks = niceMax(Math.max(0, ...points.map((p) => p.revenueKopecks)));
  const plotW = W - LEFT - RIGHT;
  const plotH = H - TOP - BOTTOM;
  const step = points.length > 0 ? plotW / points.length : plotW;
  const barW = Math.max(2, Math.min(48, step * 0.7));
  const everyLabel = Math.max(1, Math.ceil(points.length / 8));
  const bars = points.map((p, i): ChartBar => {
    const height = Math.round((p.revenueKopecks / maxKopecks) * plotH * 100) / 100;
    return {
      x: Math.round((LEFT + i * step + (step - barW) / 2) * 100) / 100,
      y: Math.round((TOP + plotH - height) * 100) / 100,
      width: Math.round(barW * 100) / 100,
      height,
      label: p.bucket,
      revenueKopecks: p.revenueKopecks,
      orders: p.orders,
      showLabel: i % everyLabel === 0,
    };
  });
  const ticks = [0, 0.5, 1].map((f) => ({ y: Math.round((TOP + plotH - f * plotH) * 100) / 100, kopecks: Math.round(maxKopecks * f) }));
  return { width: W, height: H, plotLeft: LEFT, plotTop: TOP, plotBottom: TOP + plotH, plotRight: W - RIGHT, maxKopecks, ticks, bars };
}
