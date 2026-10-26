'use server';

import { deliveryAdmin } from '@/domain/ordering/delivery';
import { field, runAction } from '../../_lib/run-action';
import { checked, idField, intField, kopecksField, listField } from '../_forms';

const BACK = '/admin/settings/shipping';

function readInput(form: FormData) {
  const manual = checked(form, 'priceManual');
  return {
    name: field(form, 'name'),
    description: field(form, 'description'),
    kind: field(form, 'kind'),
    priceKopecks: manual ? null : kopecksField(form, 'price', 'Стоимость'),
    requiresAddress: checked(form, 'requiresAddress'),
    enabled: checked(form, 'enabled'),
    sort: intField(form, 'sort', 'Порядок', 100),
    freeFromKopecks: kopecksField(form, 'freeFrom', 'Порог бесплатной доставки', { nullable: true }),
    regions: checked(form, 'wholeCountry') ? null : listField(form, 'regions'),
    etaText: field(form, 'etaText'),
    minOrderKopecks: kopecksField(form, 'minOrder', 'Минимальная сумма заказа'),
  };
}

export async function saveDeliveryAction(form: FormData): Promise<never> {
  return runAction(BACK, (session) => {
    if (field(form, 'id') === '') deliveryAdmin.create(session, readInput(form));
    else deliveryAdmin.update(session, idField(form), readInput(form));
  });
}

export async function toggleDeliveryAction(form: FormData): Promise<never> {
  return runAction(BACK, (session) => deliveryAdmin.setEnabled(session, idField(form), field(form, 'enabled') === '1'));
}

export async function deleteDeliveryAction(form: FormData): Promise<never> {
  return runAction(BACK, (session) => deliveryAdmin.remove(session, idField(form)));
}
