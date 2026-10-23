import { z } from 'zod';
import { audit } from '@/domain/admin/audit';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { FLAG_MANUAL_EDIT, FLAG_NOTIFY_RECIPIENTS, adminFlagsRepo } from '@/server/db/repositories/staff-admin';
import { ValidationError } from '@/server/http/errors';

type Opts = { db?: Db; now?: number };

export const MAX_RECIPIENTS = 10;
const emailSchema = z.email();

/** Настройки админки (не контакты магазина — их ведёт T08): ручное редактирование каталога и получатели уведомлений. */
export const settingsOps = {
  get(session: StaffSession | null, opts: Opts = {}): { manualEdit: boolean; recipients: string[] } {
    requirePermission(session, 'settings.write');
    const db = opts.db ?? getDb();
    return { manualEdit: adminFlagsRepo.isManualEditEnabled(db), recipients: adminFlagsRepo.getRecipients(db) };
  },

  setManualEdit(session: StaffSession | null, enabled: boolean, opts: Opts = {}): void {
    requirePermission(session, 'settings.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const before = adminFlagsRepo.isManualEditEnabled(db);
      adminFlagsRepo.set(db, FLAG_MANUAL_EDIT, enabled ? '1' : '0', now, `staff:${session.staffId}`);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'settings.manual_edit', entity: 'settings', entityId: FLAG_MANUAL_EDIT, before: { enabled: before }, after: { enabled } },
        { db, now },
      );
    });
  },

  /** Принимает строку (через запятую, пробел, перевод строки) или массив; возвращает сохранённый список. */
  setRecipients(session: StaffSession | null, input: string | string[], opts: Opts = {}): string[] {
    requirePermission(session, 'settings.write');
    const raw = Array.isArray(input) ? input : input.split(/[\s,;]+/);
    const list: string[] = [];
    for (const item of raw.map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      if (!emailSchema.safeParse(item).success) throw new ValidationError(`Неверный email: ${item}`, { recipients: [`Неверный email: ${item}`] });
      if (!list.includes(item)) list.push(item);
    }
    if (list.length > MAX_RECIPIENTS) throw new ValidationError(`Не больше ${MAX_RECIPIENTS} адресов`, { recipients: ['Слишком много адресов'] });
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    withTransaction(db, () => {
      const before = adminFlagsRepo.getRecipients(db);
      adminFlagsRepo.set(db, FLAG_NOTIFY_RECIPIENTS, JSON.stringify(list), now, `staff:${session.staffId}`);
      audit.record(
        { actorId: session.staffId, actorType: 'staff', action: 'settings.recipients', entity: 'settings', entityId: FLAG_NOTIFY_RECIPIENTS, before: { recipients: before }, after: { recipients: list } },
        { db, now },
      );
    });
    return list;
  },
};
