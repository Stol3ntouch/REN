import { CSV_BOM, csvCell } from '@/domain/catalog/products-list';

export type ReportIssue = { row: number | null; field: string; message: string };

/** Ошибка из журнала запуска (CSV: {row, field, message}; YML: {kind, position, externalId, message}) в единый вид. */
export function toReportIssue(e: unknown): ReportIssue {
  if (!e || typeof e !== 'object') return { row: null, field: '', message: String(e) };
  const o = e as Record<string, unknown>;
  const row = typeof o.row === 'number' && o.row > 0 ? o.row : typeof o.position === 'number' ? o.position : null;
  const field = typeof o.field === 'string' ? o.field : typeof o.kind === 'string' ? o.kind : '';
  const message = typeof o.message === 'string' ? o.message : 'ошибка';
  return { row, field, message };
}

/** Таблица ошибок построчно в CSV (строка; поле; причина). Если сохранены не все ошибки — последняя строка это сообщает. */
export function issuesToCsv(errors: readonly unknown[], totalErrors: number): string {
  const lines = [['строка', 'поле', 'причина'].map(csvCell).join(';')];
  for (const e of errors) {
    const i = toReportIssue(e);
    lines.push([i.row, i.field, i.message].map((c) => csvCell(c)).join(';'));
  }
  if (totalErrors > errors.length) lines.push([null, '', `Показаны первые ${errors.length} из ${totalErrors} ошибок`].map((c) => csvCell(c)).join(';'));
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}
