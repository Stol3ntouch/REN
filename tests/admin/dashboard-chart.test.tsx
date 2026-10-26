import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { niceMax, salesChartGeometry } from '@/domain/analytics/chart';
import { NotificationBell } from '@/ui/admin/kit/NotificationBell';
import { SearchBox } from '@/ui/admin/kit/SearchBox';
import { SalesChart } from '@/ui/admin/SalesChart';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));

describe('график продаж', () => {
  it('шкала: красивый верх, ноль не схлопывает шкалу', () => {
    expect(niceMax(0)).toBe(10_000);
    expect(niceMax(400_000)).toBe(500_000);
    expect(niceMax(123_456)).toBe(200_000);
    expect(niceMax(999_999_00)).toBeGreaterThanOrEqual(999_999_00);
  });

  it('столбцы пропорциональны выручке и укладываются в область графика', () => {
    const g = salesChartGeometry([
      { bucket: '2026-10-10', revenueKopecks: 400_000, orders: 2 },
      { bucket: '2026-10-11', revenueKopecks: 0, orders: 1 },
    ]);
    expect(g.maxKopecks).toBe(500_000);
    expect(g.bars[0]!.height).toBeCloseTo(((g.plotBottom - g.plotTop) * 400_000) / 500_000, 1);
    expect(g.bars[1]!.height).toBe(0);
    for (const b of g.bars) {
      expect(b.x).toBeGreaterThanOrEqual(g.plotLeft);
      expect(b.x + b.width).toBeLessThanOrEqual(g.plotRight);
      expect(b.y + b.height).toBeLessThanOrEqual(g.plotBottom + 0.01);
    }
  });

  it('подписи по оси X прорежены при многих точках', () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ bucket: `2026-10-${String(i + 1).padStart(2, '0')}`, revenueKopecks: 1000 * i, orders: 1 }));
    expect(salesChartGeometry(pts).bars.filter((b) => b.showLabel).length).toBeLessThanOrEqual(8);
  });

  it('SVG без скриптов и внешних ссылок, с подписью и таблицей-дублем', () => {
    const out = renderToStaticMarkup(<SalesChart points={[{ bucket: '2026-10-10', revenueKopecks: 400_000, orders: 2 }]} caption="Выручка по дням" />);
    expect(out).toContain('<svg');
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Выручка по дням"');
    expect(out).not.toMatch(/<script|href=|src=|http/);
    expect(out).toContain('<table');
  });
});

describe('поиск и колокольчик: разметка до загрузки скриптов', () => {
  it('SearchBox: форма поиска с подписью, комбобокс, панель закрыта', () => {
    const out = renderToStaticMarkup(<SearchBox />);
    expect(out).toContain('role="search"');
    expect(out).toContain('role="combobox"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('Поиск по админке');
    expect(out).not.toContain('role="listbox"');
  });

  it('NotificationBell: кнопка с числом непрочитанных; 99+ для большого числа; без числа — просто «Уведомления»', () => {
    expect(renderToStaticMarkup(<NotificationBell unread={3} />)).toContain('aria-label="Уведомления: непрочитанных 3"');
    expect(renderToStaticMarkup(<NotificationBell unread={150} />)).toContain('99+');
    const none = renderToStaticMarkup(<NotificationBell />);
    expect(none).toContain('aria-label="Уведомления"');
    expect(none).not.toContain('ak-bell__dot');
  });
});
