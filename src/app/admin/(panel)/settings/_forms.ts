import { parseRubles } from '@/domain/pricing/format';
import { ValidationError } from '@/server/http/errors';
import { field } from '../_lib/run-action';

/** Разбор полей форм настроек: рубли → копейки, проценты → сотые доли, флажки, списки. Деньги не проходят через float. */

export const checked = (form: FormData, name: string): boolean => {
  const v = form.get(name);
  return v === 'on' || v === '1';
};

/** Сумма в рублях («1 250,50») → копейки; пусто → null (если nullable), иначе ошибка поля. */
export function kopecksField(form: FormData, name: string, label: string, opts: { nullable: true }): number | null;
export function kopecksField(form: FormData, name: string, label: string, opts?: { nullable?: false }): number;
export function kopecksField(form: FormData, name: string, label: string, opts: { nullable?: boolean } = {}): number | null {
  const raw = field(form, name);
  if (raw === '') {
    if (opts.nullable) return null;
    return 0;
  }
  const v = parseRubles(raw);
  if (v === null) throw new ValidationError(`${label}: введите сумму в рублях, например 1250 или 1250,50`, { [name]: [`${label}: неверная сумма`] });
  return v;
}

/** Процент («1,5») → сотые доли процента (150). Не больше трёх знаков до запятой и двух после. */
export function basisPointsField(form: FormData, name: string, label: string): number {
  const raw = field(form, name).replace(/\s/g, '').replace(',', '.');
  if (raw === '') return 0;
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(raw);
  if (!m) throw new ValidationError(`${label}: введите процент, например 1,5`, { [name]: [`${label}: неверный процент`] });
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export function intField(form: FormData, name: string, label: string, fallback = 0): number {
  const raw = field(form, name);
  if (raw === '') return fallback;
  if (!/^-?\d{1,9}$/.test(raw)) throw new ValidationError(`${label}: нужно целое число`, { [name]: [`${label}: нужно целое число`] });
  return Number(raw);
}

export function idField(form: FormData, name = 'id'): number {
  const n = Number(field(form, name));
  if (!Number.isInteger(n) || n < 1) throw new ValidationError('Запись не найдена');
  return n;
}

/** Список из многострочного поля: по строкам, запятым и «;», без пустых. */
export function listField(form: FormData, name: string): string[] {
  return field(form, name)
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Копейки → строка для поля формы («1250» или «1250,50»), без float. */
export function rubInput(k: number | null | undefined): string {
  if (k === null || k === undefined) return '';
  const whole = Math.floor(k / 100);
  const frac = k % 100;
  return frac === 0 ? String(whole) : `${whole},${String(frac).padStart(2, '0')}`;
}

/** Сотые доли процента → строка («1,5»). */
export function bpInput(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  return frac === 0 ? String(whole) : `${whole},${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}
