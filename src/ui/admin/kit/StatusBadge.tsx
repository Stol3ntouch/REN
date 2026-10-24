import type { ReactNode } from 'react';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Статус одним словом: цвет всегда дублируется текстом (смысл не держится на цвете). */
export function StatusBadge({ tone = 'neutral', children }: { tone?: StatusTone; children: ReactNode }) {
  return (
    <span className={`ak-badge ak-badge--${tone}`}>
      <span className="ak-badge__dot" aria-hidden="true" />
      {children}
    </span>
  );
}
