import { z } from 'zod';

/** Параметры применения CSV/YML. Хранятся в import_runs.options вместе с кодировкой и сопоставлением. */
export const importOptionsSchema = z.object({
  /** create_only — существующие товары пропускаются; update — существующие обновляются. */
  mode: z.enum(['create_only', 'update']).default('update'),
  /** По какому полю находится существующий товар (режим update). В create_only существующим считается совпавший по артикулу или внешнему ID. */
  key: z.enum(['sku', 'external_id', 'barcode']).default('sku'),
  /** Режим update: создавать товары, которых нет в базе. */
  createMissing: z.boolean().default(true),
  /** Неизвестные категории и бренды: создавать или считать ошибкой строки. */
  unknownRefs: z.enum(['create', 'error']).default('error'),
  /** Пустая ячейка стирает значение (иначе значение не трогается). */
  clearEmpty: z.boolean().default(false),
  /** Перезаписывать поля, закреплённые за ручной правкой (locked_fields). */
  overrideLocked: z.boolean().default(false),
  /** Скачивать фото по ссылкам (через safeFetchImage). */
  downloadImages: z.boolean().default(false),
  /** batch — пакеты по 500 строк, ошибочные строки пропускаются; atomic — всё или ничего (до 5000 строк). */
  transaction: z.enum(['batch', 'atomic']).default('batch'),
});

export type ImportOptions = z.infer<typeof importOptionsSchema>;
export const DEFAULT_OPTIONS: ImportOptions = importOptionsSchema.parse({});

/** Читает настройки из JSON журнала; повреждённое значение заменяется умолчанием, а не ломает страницу. */
export function parseOptions(raw: unknown): ImportOptions {
  const r = importOptionsSchema.safeParse(raw ?? {});
  if (r.success) return r.data;
  const picked: Record<string, unknown> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const one = importOptionsSchema.shape[k as keyof typeof importOptionsSchema.shape]?.safeParse(v);
      if (one?.success) picked[k] = v;
    }
  }
  return importOptionsSchema.parse(picked);
}
