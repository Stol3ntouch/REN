'use server';

import { paymentAdmin } from '@/domain/ordering/payment-methods';
import { field, runAction } from '../../_lib/run-action';
import { basisPointsField, checked, idField, intField, kopecksField } from '../_forms';

const BACK = '/admin/settings/payments';

function readInput(form: FormData) {
  return {
    name: field(form, 'name'),
    description: field(form, 'description'),
    enabled: checked(form, 'enabled'),
    sort: intField(form, 'sort', 'Порядок', 100),
    feePercentBp: basisPointsField(form, 'feePercent', 'Комиссия, %'),
    feeFixedKopecks: kopecksField(form, 'feeFixed', 'Фиксированная комиссия'),
    minKopecks: kopecksField(form, 'min', 'Минимальная сумма', { nullable: true }),
    maxKopecks: kopecksField(form, 'max', 'Максимальная сумма', { nullable: true }),
    mode: field(form, 'mode') === 'test' ? 'test' : 'live',
  };
}

/** Секретов в форме нет и быть не может: ключи провайдера задаются только в окружении сервера. */
export async function savePaymentAction(form: FormData): Promise<never> {
  return runAction(BACK, (session) => {
    if (field(form, 'id') === '') paymentAdmin.create(session, readInput(form));
    else paymentAdmin.update(session, idField(form), readInput(form));
  });
}

export async function deletePaymentAction(form: FormData): Promise<never> {
  return runAction(BACK, (session) => paymentAdmin.remove(session, idField(form)));
}

export async function checkPaymentAction(): Promise<never> {
  return runAction(BACK, async (session) => {
    await paymentAdmin.check(session);
  });
}
