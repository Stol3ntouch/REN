import type { ZodError } from 'zod';
import { ValidationError, type FieldErrors } from '@/server/http/errors';

/** Ошибки zod → ValidationError с сообщением первого поля и ошибками по полям формы. */
export function zodToValidation(error: ZodError): ValidationError {
  const fields: FieldErrors = {};
  for (const i of error.issues) (fields[String(i.path[0] ?? 'form')] ??= []).push(i.message);
  return new ValidationError(Object.values(fields)[0]?.[0] ?? 'Проверьте введённые данные', fields);
}

/** Целое число в диапазоне; иначе сообщение об ошибке. */
export function intInRange(raw: unknown, min: number, max: number): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** http(s)-адрес с именем хоста. */
export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '';
  } catch {
    return false;
  }
}
