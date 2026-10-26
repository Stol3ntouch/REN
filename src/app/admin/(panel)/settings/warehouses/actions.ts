'use server';

import { warehouseReports, warehousesAdmin } from '@/domain/catalog/warehouses';
import { field, runAction } from '../../_lib/run-action';
import { checked, idField, intField } from '../_forms';

const BACK = '/admin/settings/warehouses';

export async function saveWarehouseAction(form: FormData): Promise<never> {
  return runAction(BACK, (session) => {
    const input = { name: field(form, 'name'), address: field(form, 'address'), active: checked(form, 'active'), sort: intField(form, 'sort', 'Порядок', 100) };
    if (field(form, 'id') === '') warehousesAdmin.create(session, input);
    else warehousesAdmin.update(session, idField(form), input);
  });
}

export async function setDefaultWarehouseAction(form: FormData): Promise<never> {
  return runAction(BACK, (session) => warehousesAdmin.setDefault(session, idField(form)));
}

export async function deleteWarehouseAction(form: FormData): Promise<never> {
  return runAction(BACK, (session) => warehousesAdmin.remove(session, idField(form)));
}

export async function saveThresholdAction(form: FormData): Promise<never> {
  return runAction(BACK, (session) => warehouseReports.setThreshold(session, intField(form, 'threshold', 'Порог', -1)));
}
