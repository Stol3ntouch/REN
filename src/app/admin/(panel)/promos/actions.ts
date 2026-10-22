'use server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/domain/admin/staff-session';
import type { StaffSession } from '@/domain/admin/permissions';
import { moscowDayStart, promoOps } from '@/domain/ordering/admin-ops';
import { parseRubles } from '@/domain/pricing/format';
import { AppError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { assertOrigin } from '@/server/http/origin';

const text = (form: FormData, name: string): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim() : '';
};

const DAY_MS = 86_400_000;

function dateOrNull(form: FormData, name: string, endOfDay: boolean): number | null {
  const v = text(form, name);
  if (v === '') return null;
  const start = moscowDayStart(v);
  if (start === undefined) throw new ValidationError('Укажите дату полностью', { [name]: ['Неверная дата'] });
  return endOfDay ? start + DAY_MS - 1 : start;
}

function intOrNull(form: FormData, name: string): number | null {
  const v = text(form, name);
  if (v === '') return null;
  if (!/^\d{1,9}$/.test(v)) throw new ValidationError('Введите целое число', { [name]: ['Нужно целое число'] });
  return Number(v);
}

/** Форма → вход promoOps. Процент — целое 1–100; фиксированная скидка и минимальная сумма вводятся в рублях. */
function readPromo(form: FormData) {
  const type = text(form, 'type');
  const rawValue = text(form, 'value');
  let value: number;
  if (type === 'percent') {
    if (!/^\d{1,3}$/.test(rawValue)) throw new ValidationError('Процент — целое число от 1 до 100', { value: ['Процент — целое число от 1 до 100'] });
    value = Number(rawValue);
  } else {
    const kopecks = parseRubles(rawValue);
    if (kopecks === null) throw new ValidationError('Сумма скидки — в рублях, например 500 или 500,50', { value: ['Неверная сумма'] });
    value = kopecks;
  }
  const minRaw = text(form, 'minSubtotal');
  const minKopecks = minRaw === '' ? 0 : parseRubles(minRaw);
  if (minKopecks === null) throw new ValidationError('Минимальная сумма — в рублях', { minSubtotal: ['Неверная сумма'] });
  return {
    code: text(form, 'code'),
    type,
    value,
    startsAt: dateOrNull(form, 'startsAt', false),
    endsAt: dateOrNull(form, 'endsAt', true),
    usageLimit: intOrNull(form, 'usageLimit'),
    minSubtotalKopecks: minKopecks,
    enabled: form.get('enabled') === 'on',
  };
}

async function run(op: (session: StaffSession) => void): Promise<never> {
  try {
    assertOrigin({ method: 'POST', headers: await headers() });
    const session = requireStaff(await cookies());
    op(session);
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/admin/login');
    if (e instanceof AppError) redirect(`/admin/promos?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath('/admin/promos');
  redirect('/admin/promos?ok=1');
}

/** Создание или изменение промокода (право promos.write проверяет promoOps внутри). */
export async function savePromoAction(form: FormData): Promise<void> {
  await run((session) => {
    const idRaw = text(form, 'id');
    const data = readPromo(form);
    if (idRaw === '') promoOps.create(session, data);
    else promoOps.update(session, Number(idRaw), data);
  });
}

export async function deletePromoAction(form: FormData): Promise<void> {
  await run((session) => {
    promoOps.remove(session, Number(text(form, 'id')));
  });
}
