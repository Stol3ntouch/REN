-- C07: единый импорт и экспорт (мастер CSV/YML). Журнал запусков расширяется, появляются пресеты сопоставления колонок.
-- Старые записи import_runs остаются как есть: kind='import', status='done', счётчики прежние.

-- Тип операции: import — загрузка файла, export — выгрузка товаров (число строк в products_created не пишется, см. rows_total).
ALTER TABLE import_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'import' CHECK (kind IN ('import', 'export'));
-- Формат файла: yml | csv (NULL у старых записей).
ALTER TABLE import_runs ADD COLUMN format TEXT;
-- Ход выполнения: uploaded (файл загружен) → running → done | failed.
ALTER TABLE import_runs ADD COLUMN status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('uploaded', 'running', 'done', 'failed'));
-- Сколько строк обработано (запись после каждого пакета) и сколько всего.
ALTER TABLE import_runs ADD COLUMN progress INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_runs ADD COLUMN rows_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_runs ADD COLUMN rows_skipped INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_runs ADD COLUMN file_size INTEGER NOT NULL DEFAULT 0;
-- JSON: кодировка, разделитель, сопоставление колонок, режим, ключ, флажки. Файл здесь не хранится.
ALTER TABLE import_runs ADD COLUMN options TEXT NOT NULL DEFAULT '{}';
CREATE INDEX idx_import_runs_kind_status ON import_runs(kind, status);

-- Сохранённое сопоставление колонок («пресет»): заголовок колонки файла -> поле системы.
CREATE TABLE import_mappings (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  mapping    TEXT    NOT NULL,
  created_by INTEGER,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);
CREATE UNIQUE INDEX ux_import_mappings_name ON import_mappings(name COLLATE NOCASE);
