import { salesChartGeometry, type ChartPoint } from '@/domain/analytics/chart';
import { formatRub } from '@/domain/pricing/format';
import './c10.css';

/**
 * Продажи по периодам: столбцы выручки (оплаченные неотменённые заказы). Чистый SVG, без скриптов и внешних
 * библиотек; значения — только из переданных агрегатов. Для скринридеров — подпись и таблица ниже.
 */
export function SalesChart({ points, caption }: { points: readonly ChartPoint[]; caption: string }) {
  const g = salesChartGeometry(points);
  return (
    <figure style={{ margin: 0 }}>
      <svg className="dash-chart" viewBox={`0 0 ${g.width} ${g.height}`} role="img" aria-label={caption}>
        <title>{caption}</title>
        {g.ticks.map((t) => (
          <g key={t.y}>
            <line className="grid" x1={g.plotLeft} x2={g.plotRight} y1={t.y} y2={t.y} />
            <text className="axis" x={g.plotLeft - 6} y={t.y + 4} textAnchor="end">
              {formatRub(t.kopecks)}
            </text>
          </g>
        ))}
        {g.bars.map((b) => (
          <g key={b.label}>
            <rect className="bar" x={b.x} y={b.y} width={b.width} height={Math.max(b.height, b.revenueKopecks > 0 ? 1 : 0)} rx={2}>
              <title>{`${b.label}: ${formatRub(b.revenueKopecks)}, заказов ${b.orders}`}</title>
            </rect>
            {b.showLabel ? (
              <text className="label" x={b.x + b.width / 2} y={g.plotBottom + 16} textAnchor="middle">
                {b.label.length > 7 ? b.label.slice(5) : b.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <details>
        <summary className="dash-muted">Данные таблицей</summary>
        <table className="adm-table">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Период</th>
              <th scope="col" className="num">
                Заказов
              </th>
              <th scope="col" className="num">
                Выручка
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.bucket}>
                <td>{p.bucket}</td>
                <td className="num">{p.orders}</td>
                <td className="num">{formatRub(p.revenueKopecks)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
