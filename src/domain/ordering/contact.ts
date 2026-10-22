import { z } from 'zod';
import { ValidationError, type FieldErrors } from '@/server/http/errors';

/** Только цифры телефона; 8XXXXXXXXXX → 7XXXXXXXXXX. */
export function phoneDigits(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length === 11 && d.startsWith('8') ? `7${d.slice(1)}` : d;
}

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

const contactSchema = z.object({
  name: z.string({ error: 'Укажите имя' }).trim().min(2, 'Укажите имя (не короче 2 символов)').max(100, 'Слишком длинное имя'),
  email: z
    .string({ error: 'Укажите email' })
    .trim()
    .toLowerCase()
    .max(254, 'Слишком длинный email')
    .pipe(z.email({ error: 'Введите корректный email' })),
  phone: z
    .string({ error: 'Укажите телефон' })
    .trim()
    .max(30, 'Слишком длинный телефон')
    .refine((v) => {
      const n = phoneDigits(v).length;
      return n >= 10 && n <= 15;
    }, 'Введите телефон полностью, например +7 900 000-00-00'),
  comment: z.preprocess(emptyToNull, z.string().trim().max(1000, 'Комментарий не длиннее 1000 символов').nullable().optional()),
  address: z.preprocess(emptyToNull, z.string().trim().max(300, 'Адрес не длиннее 300 символов').nullable().optional()),
});

export const placeInputSchema = z.object({
  cartId: z.number({ error: 'Не указана корзина' }).int().positive(),
  contact: contactSchema,
  deliveryMethodId: z.number({ error: 'Выберите способ получения' }).int().positive('Выберите способ получения'),
  paymentMethodId: z.number({ error: 'Выберите способ оплаты' }).int().positive('Выберите способ оплаты'),
  idempotencyKey: z
    .string({ error: 'Не указан ключ запроса' })
    .regex(/^[A-Za-z0-9_.:-]{16,128}$/, 'Некорректный ключ запроса'),
  consent: z.literal(true, { error: 'Нужно согласие на обработку персональных данных' }),
});

export type PlaceInput = z.infer<typeof placeInputSchema>;

/** Разбор входа place(): лишние поля (цены, суммы, позиции) отбрасываются, ошибки — по полям. */
export function parsePlaceInput(input: unknown): PlaceInput {
  const res = placeInputSchema.safeParse(input);
  if (res.success) return res.data;
  const fields: FieldErrors = {};
  for (const issue of res.error.issues) {
    const key = issue.path.join('.') || 'form';
    (fields[key] ??= []).push(issue.message);
  }
  throw new ValidationError(Object.values(fields)[0]?.[0] ?? 'Проверьте введённые данные', fields);
}
