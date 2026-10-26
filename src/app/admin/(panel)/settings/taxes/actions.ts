'use server';

import { taxesAdmin } from '@/domain/ordering/pricing-rules';
import { field, runAction } from '../../_lib/run-action';
import { basisPointsField, checked, idField, intField } from '../_forms';

const BACK = '/admin/settings/taxes';

export async function saveTaxSettingsAction(form: FormData): Promise<never> {
  return runAction(BACK, (session) => taxesAdmin.saveSettings(session, { rule: field(form, 'rule'), step: field(form, 'step'), pricesIncludeTax: checked(form, 'pricesIncludeTax') }));
}

export async function saveTaxRateAction(form: FormData): Promise<never> {
  return runAction(BACK, (session) => {
    const input = {
      name: field(form, 'name'),
      rateBp: basisPointsField(form, 'rate', 'Ставка, %'),
      includedInPrice: checked(form, 'includedInPrice'),
      active: checked(form, 'active'),
      sort: intField(form, 'sort', 'Порядок', 100),
    };
    if (field(form, 'id') === '') taxesAdmin.createRate(session, input);
    else taxesAdmin.updateRate(session, idField(form), input);
  });
}

export async function setDefaultTaxAction(form: FormData): Promise<never> {
  return runAction(BACK, (session) => taxesAdmin.setDefault(session, field(form, 'id') === '' ? null : idField(form)));
}

export async function deleteTaxRateAction(form: FormData): Promise<never> {
  return runAction(BACK, (session) => taxesAdmin.removeRate(session, idField(form)));
}
