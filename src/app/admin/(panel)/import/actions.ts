'use server';

import { ValidationError } from '@/server/http/errors';
import { importOps } from '../_lib/import-ops';
import { field, runAction } from '../_lib/run-action';

function runId(form: FormData): number {
  const id = Number(field(form, 'run'));
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('Запуск не найден — загрузите файл заново');
  return id;
}

const back = (id: number, step: string): string => `/admin/import?run=${id}&step=${step}`;

/** Шаг «Файл»: поправить кодировку и разделитель вручную. */
export async function configureFileAction(form: FormData): Promise<void> {
  const id = runId(form);
  return runAction(back(id, 'file'), (s) => importOps.configureFile(s, id, { encoding: field(form, 'encoding'), delimiter: field(form, 'delimiter') }));
}

/** Шаг «Сопоставление»: сохранить, подобрать заново, применить/сохранить/удалить пресет. */
export async function mappingAction(form: FormData): Promise<void> {
  const id = runId(form);
  const intent = field(form, 'intent');
  return runAction(back(id, 'mapping'), (s) => {
    if (intent === 'auto') return importOps.resetMapping(s, id);
    if (intent === 'preset-apply') return importOps.applyPreset(s, id, Number(field(form, 'preset')));
    if (intent === 'preset-delete') return importOps.deletePreset(s, Number(field(form, 'preset')));
    const fields: string[] = [];
    for (const [k, v] of form.entries()) {
      const m = /^col-(\d+)$/.exec(k);
      if (m && typeof v === 'string') fields[Number(m[1])] = v;
    }
    importOps.saveMapping(s, id, fields);
    if (intent === 'preset-save') importOps.savePreset(s, id, field(form, 'presetName'));
  });
}

/** Шаг «Проверка»: режим, ключ и флажки. */
export async function optionsAction(form: FormData): Promise<void> {
  const id = runId(form);
  return runAction(back(id, 'check'), (s) => {
    const on = (name: string) => form.get(name) === 'on';
    importOps.setOptions(s, id, {
      mode: field(form, 'mode'),
      key: field(form, 'key'),
      createMissing: on('createMissing'),
      unknownRefs: field(form, 'unknownRefs'),
      clearEmpty: on('clearEmpty'),
      overrideLocked: on('overrideLocked'),
      downloadImages: on('downloadImages'),
      transaction: field(form, 'transaction'),
    });
  });
}

/** Шаг «Применение»: запускает импорт в фоне и возвращает на страницу хода выполнения. */
export async function applyAction(form: FormData): Promise<void> {
  const id = runId(form);
  return runAction(back(id, 'apply'), (s) => {
    importOps.apply(s, id, { confirmOverride: form.get('confirmOverride') === 'on' });
  });
}
