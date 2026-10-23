import type { StaffSession } from '@/domain/admin/permissions';
import { applyImport, parseYml, planImport } from '@/importing/yml';
import type { Db } from '@/server/db/connection';
import { FLAG_MANUAL_EDIT, adminFlagsRepo } from '@/server/db/repositories/staff-admin';
import { productsRepo } from '@/server/db/repositories/products';

export const T0 = Date.UTC(2026, 9, 22, 12);
export const admin: StaffSession = { staffId: 1, email: 'boss@shop.test', name: 'Админ', role: 'admin' };
export const manager: StaffSession = { staffId: 2, email: 'mgr@shop.test', name: 'Менеджер', role: 'manager' };

export function setManualEdit(db: Db, on: boolean): void {
  adminFlagsRepo.set(db, FLAG_MANUAL_EDIT, on ? '1' : '0', T0, 'test');
}

export async function importXml(db: Db, xml: string): Promise<void> {
  await applyImport(planImport(parseYml(xml), db, { fileName: 't.yml' }), db, { now: new Date(T0) });
}

export const productByExternal = (db: Db, id: string) => productsRepo.findByExternalId(db, 'yml', id)!;
