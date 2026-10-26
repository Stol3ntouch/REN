import { MAX_IMPORT_ROWS } from './limits';
import { ImportFileError } from './yml/parse';

export type Delimiter = ';' | ',' | '\t';
export const DELIMITERS: readonly Delimiter[] = [';', ',', '\t'];

/** Разделитель по первым строкам: берётся тот, чьё число вне кавычек одинаково во всех строках и больше. Не нашёлся — «;». */
export function detectDelimiter(text: string): Delimiter {
  const lines = sampleLines(text, 10);
  let best: Delimiter = ';';
  let bestScore = 0;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    const consistent = counts.filter((c) => c === first).length;
    const score = consistent * 1000 + first; // согласованность важнее количества
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function sampleLines(text: string, n: number): string[] {
  const out: string[] = [];
  let inQuotes = false;
  let cur = '';
  for (let i = 0; i < text.length && out.length < n; i++) {
    const ch = text[i]!;
    if (ch === '"') inQuotes = !inQuotes;
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (cur !== '') out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur !== '' && out.length < n) out.push(cur);
  return out;
}

function countOutsideQuotes(line: string, d: string): number {
  let n = 0;
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n;
}

export type CsvTable = { delimiter: Delimiter; rows: string[][] };

/**
 * Разбор CSV (RFC 4180): кавычки, удвоенные кавычки, переносы строк внутри ячейки, CRLF/LF. Значения остаются текстом —
 * ничего не вычисляется (формулы вида =cmd не исполняются). Пустые строки пропускаются.
 * Файл с незакрытой кавычкой считается повреждённым; больше MAX_IMPORT_ROWS строк данных — отклоняется.
 */
export function parseCsv(text: string, opts: { delimiter?: Delimiter; maxRows?: number } = {}): CsvTable {
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const maxData = opts.maxRows ?? MAX_IMPORT_ROWS;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let cellWasQuoted = false;

  const pushCell = () => {
    row.push(cell);
    cell = '';
    cellWasQuoted = false;
  };
  const pushRow = () => {
    pushCell();
    if (row.length === 1 && row[0] === '' && !cellWasQuotedRow) {
      row = [];
      return;
    }
    rows.push(row);
    if (rows.length - 1 > maxData) throw new ImportFileError(`В файле больше ${String(maxData).replace(/\B(?=(\d{3})+$)/g, ' ')} строк — разделите его на части`);
    row = [];
  };
  let cellWasQuotedRow = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '' && !cellWasQuoted) {
      inQuotes = true;
      cellWasQuoted = true;
      cellWasQuotedRow = true;
    } else if (ch === delimiter) pushCell();
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow();
      cellWasQuotedRow = false;
    } else cell += ch;
  }
  if (inQuotes) throw new ImportFileError('Файл повреждён: не закрыта кавычка. Проверьте, что каждая ячейка с кавычками заканчивается кавычкой.');
  if (cell !== '' || row.length > 0 || cellWasQuoted) pushRow();
  return { delimiter, rows };
}
