import { z } from 'zod';
import { ValidationError, type FieldErrors } from '@/server/http/errors';

/** Серверные схемы публичных форм. Тексты ошибок — на русском, для пользователя. */

const text = (label: string, min: number, max: number) =>
  z
    .string({ error: `Заполните поле «${label}»` })
    .trim()
    .min(min, min <= 2 ? `Заполните поле «${label}»` : `«${label}»: не короче ${min} знаков`)
    .max(max, `«${label}»: не длиннее ${max} знаков`);

/** Телефон РФ: 10 цифр или 11 (с 7/8) → +7XXXXXXXXXX. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) return `+7${digits.slice(1)}`;
  return null;
}

const phone = z
  .string({ error: 'Укажите телефон' })
  .trim()
  .transform((v, ctx) => {
    const p = normalizePhone(v);
    if (!p) ctx.addIssue({ code: 'custom', message: 'Укажите телефон в формате +7 900 000-00-00' });
    return p ?? v;
  });

const email = z.string({ error: 'Укажите email' }).trim().toLowerCase().max(254, 'Слишком длинный email').pipe(z.email('Проверьте адрес электронной почты'));
const optionalEmail = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), email.optional());

const consent = z.literal(true, { error: 'Нужно согласие на обработку персональных данных' });
const name = text('Имя', 2, 80);
const productId = z.coerce.number({ error: 'Товар не указан' }).int('Товар не указан').positive('Товар не указан');

export const repairSchema = z
  .object({
    name,
    phone,
    email: optionalEmail,
    equipmentType: text('Тип техники', 2, 100),
    description: text('Описание неисправности', 10, 2000),
    preferredContact: z.enum(['phone', 'email', 'messenger'], { error: 'Выберите способ связи' }).default('phone'),
    consent,
  })
  .superRefine((v, ctx) => {
    if (v.preferredContact === 'email' && !v.email) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Укажите email — вы выбрали связь по почте' });
  });

export const callbackSchema = z.object({ name, phone, consent });

export const contactSchema = z.object({
  name,
  email,
  phone: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), phone.optional()),
  message: text('Сообщение', 10, 2000),
  consent,
});

export const questionSchema = z.object({ productId, name, email, message: text('Вопрос', 5, 1000), consent });

export const reviewSchema = z.object({
  productId,
  rating: z.coerce.number({ error: 'Поставьте оценку от 1 до 5' }).int('Оценка — целое число от 1 до 5').min(1, 'Поставьте оценку от 1 до 5').max(5, 'Поставьте оценку от 1 до 5'),
  authorName: text('Имя', 2, 60),
  body: text('Отзыв', 10, 2000),
  consent,
});

export const requestUpdateSchema = z.object({
  status: z.enum(['new', 'in_work', 'done', 'cancelled'], { error: 'Неизвестный статус' }).optional(),
  note: z.string().trim().max(2000, 'Заметка не длиннее 2000 знаков').optional(),
});

/** Разбор входа: ошибки собираются по полям, наружу уходит ValidationError (400). */
export function parseForm<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const res = schema.safeParse(input);
  if (res.success) return res.data;
  const fields: FieldErrors = {};
  for (const issue of res.error.issues) {
    const key = String(issue.path[0] ?? 'form');
    (fields[key] ??= []).push(issue.message);
  }
  throw new ValidationError(Object.values(fields)[0]?.[0] ?? 'Проверьте введённые данные', fields);
}
