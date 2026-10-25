/** Источник импортируемых записей (часть ключа идемпотентности (source, external_id)). */
export const YML_SOURCE = 'yml';

/** Макс. размер файла импорта. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
/** Макс. число фото у одного товара (лишние отбрасываются с предупреждением). */
export const MAX_IMAGES_PER_PRODUCT = 25;

/** Поля товара, которые можно закрепить в `locked_fields`, чтобы импорт их не перезаписывал. */
export const LOCKABLE_FIELDS = [
  'name',
  'sku',
  'description',
  'category',
  'price',
  'in_stock',
  'attributes',
  'images',
  // C04: поля карточки, которые импорт сам не пишет, но не должен затирать (бренд из <vendor>) или менять, если они правлены вручную
  'brand',
  'barcode',
  'old_price',
  'short_description',
  'flags',
] as const;
export type LockableField = (typeof LOCKABLE_FIELDS)[number];

export type ParsedCategory = {
  externalId: string;
  parentExternalId: string | null;
  name: string;
  /** Порядковый номер в файле (для сортировки). */
  position: number;
};

export type ParsedAttribute = { name: string; value: string };

export type ParsedOffer = {
  externalId: string;
  name: string;
  /** Артикул = <model>. */
  sku: string | null;
  categoryExternalId: string;
  priceKopecks: number;
  inStock: boolean;
  /** HTML описания, очищенный от опасной разметки. */
  description: string | null;
  /** Последний сегмент <url> — подсказка для slug. */
  slugHint: string | null;
  pictures: string[];
  attributes: ParsedAttribute[];
  /** Производитель из <vendor>; null — в файле его нет (бренд не выдумывается). */
  vendor?: string | null;
  /** Порядковый номер offer в файле. */
  position: number;
};

export type RowErrorKind = 'file' | 'category' | 'offer' | 'image';

/** Ошибка или предупреждение по строке файла; остальные строки импортируются. */
export type RowError = {
  kind: RowErrorKind;
  externalId?: string;
  position?: number;
  message: string;
};

export type ParsedYml = {
  categories: ParsedCategory[];
  offers: ParsedOffer[];
  errors: RowError[];
};

export type PlanAction = 'create' | 'update' | 'unchanged';

export type PlannedCategory = {
  action: PlanAction;
  externalId: string;
  name: string;
  slug: string;
  /** Имена изменяемых полей (для update). */
  changes: string[];
  data: ParsedCategory;
};

export type PlannedProduct = {
  action: PlanAction;
  externalId: string;
  name: string;
  slug: string;
  /** Поля, которые изменятся (для update). */
  changes: string[];
  /** Поля, где файл отличается, но они закреплены в locked_fields и не будут перезаписаны. */
  lockedSkipped: string[];
  data: ParsedOffer;
};

export type PlanSummary = {
  categories: { create: number; update: number; unchanged: number };
  products: { create: number; update: number; unchanged: number };
  errors: number;
};

export type ImportPlan = {
  fileName: string | null;
  generatedAt: string;
  categories: PlannedCategory[];
  products: PlannedProduct[];
  errors: RowError[];
  summary: PlanSummary;
};

export type ImportReport = {
  runId: number;
  fileName: string | null;
  startedAt: string;
  finishedAt: string;
  categories: { created: number; updated: number; unchanged: number };
  products: { created: number; updated: number; unchanged: number; lockedFieldsSkipped: number };
  images: { enabled: boolean; stored: number; failed: number; pending: number };
  errors: RowError[];
  notes: string[];
};
