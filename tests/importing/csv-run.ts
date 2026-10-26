import { autoMap, type Mapping } from '@/importing/fields';
import { parseOptions, type ImportOptions } from '@/importing/options';
import { applyRows, type ApplyOutcome } from '@/importing/products/apply';
import { planRows, type CsvPlan } from '@/importing/products/plan';
import { parseRows } from '@/importing/rows';
import { readCsvTable } from '@/importing/table';
import type { Db } from '@/server/db/connection';
import { attributesRepo } from '@/server/db/repositories/attributes';
import { utf8 } from './csv-helpers';

export const T0 = Date.UTC(2026, 9, 24, 12);

/** CSV-текст → план (без записи). */
export function planCsv(db: Db, text: string | Uint8Array, opts: Partial<ImportOptions> = {}, mapping?: Mapping): CsvPlan {
  const table = readCsvTable(typeof text === 'string' ? utf8(text) : text);
  const m = mapping ?? autoMap(table.headers, attributesRepo.listAll(db));
  return planRows(db, parseRows(table.headers, table.rows, m), parseOptions(opts));
}

/** CSV-текст → план и применение. */
export async function runCsv(db: Db, text: string | Uint8Array, opts: Partial<ImportOptions> = {}, extra: { mapping?: Mapping; onProgress?: (n: number) => void } = {}): Promise<{ plan: CsvPlan; outcome: ApplyOutcome }> {
  const options = parseOptions(opts);
  const plan = planCsv(db, text, opts, extra.mapping);
  const outcome = await applyRows(db, plan, { runId: 1, actorId: 1, now: T0, options, onProgress: extra.onProgress });
  return { plan, outcome };
}
