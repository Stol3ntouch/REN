'use server';

import { warehouseStock } from '@/domain/catalog/warehouses';
import { field, runAction } from '../_lib/run-action';
import { idField, intField } from '../settings/_forms';

const BACK = '/admin/warehouse';

const qty = (form: FormData) => intField(form, 'qty', 'Количество', 0);

/** Оприходование на склад. Право warehouses.write проверяет warehouseStock. */
export async function receiveAction(form: FormData): Promise<never> {
  return runAction(`${BACK}?tab=movements`, (session) => {
    warehouseStock.receive(session, { productId: idField(form, 'productId'), warehouseId: idField(form, 'warehouseId'), qty: qty(form), reason: field(form, 'reason') });
  });
}

export async function writeOffAction(form: FormData): Promise<never> {
  return runAction(`${BACK}?tab=movements`, (session) => {
    warehouseStock.writeOff(session, { productId: idField(form, 'productId'), warehouseId: idField(form, 'warehouseId'), qty: qty(form), reason: field(form, 'reason') });
  });
}

export async function transferAction(form: FormData): Promise<never> {
  return runAction(`${BACK}?tab=movements`, (session) => {
    warehouseStock.transfer(session, {
      productId: idField(form, 'productId'),
      fromWarehouseId: idField(form, 'fromWarehouseId'),
      toWarehouseId: idField(form, 'toWarehouseId'),
      qty: qty(form),
      reason: field(form, 'reason'),
    });
  });
}
