export { MAX_IMPORT_BYTES } from './yml/types';

/** Строк данных в одном CSV (без заголовка). Больше — файл отклоняется до разбора. */
export const MAX_IMPORT_ROWS = 50_000;
/** Размер пакета: одна транзакция, после неё запись прогресса и передышка серверу. */
export const BATCH_SIZE = 500;
/** Режим «всё или ничего»: одна транзакция, поэтому ограничена по числу строк. */
export const ATOMIC_MAX_ROWS = 5_000;
/** Сколько строк показывает предпросмотр. */
export const PREVIEW_ROWS = 50;
/** Сколько ошибок хранится в журнале запуска. */
export const MAX_STORED_ISSUES = 2_000;
/** Сколько фото у товара. */
export const MAX_IMAGES_PER_ROW = 25;
/** Максимум строк в выгрузке товаров. */
export const MAX_EXPORT_ROWS = 50_000;
