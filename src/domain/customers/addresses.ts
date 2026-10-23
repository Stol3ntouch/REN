import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { addressesRepo, type AddressRow } from '@/server/db/repositories/addresses';
import { NotFoundError, ValidationError, type FieldErrors } from '@/server/http/errors';

export const MAX_ADDRESSES = 10;

export type AddressInput = { label: string; address: string };
export type { AddressRow };

export const addresses = {
  list(userId: number, opts: { db?: Db } = {}): AddressRow[] {
    return addressesRepo.listByUser(opts.db ?? getDb(), userId);
  },

  /** Адрес 5–300 символов, подпись до 60 (необязательна), не больше 10 адресов на пользователя. */
  add(userId: number, input: AddressInput, opts: { db?: Db; now?: number } = {}): AddressRow {
    const db = opts.db ?? getDb();
    const fields: FieldErrors = {};
    const label = typeof input.label === 'string' ? input.label.replace(/\s+/g, ' ').trim() : '';
    const address = typeof input.address === 'string' ? input.address.replace(/\s+/g, ' ').trim() : '';
    if (label.length > 60) fields.label = ['Подпись не длиннее 60 символов'];
    if (address.length < 5) fields.address = ['Укажите адрес полностью (не короче 5 символов)'];
    else if (address.length > 300) fields.address = ['Адрес не длиннее 300 символов'];
    if (Object.keys(fields).length > 0) throw new ValidationError('Проверьте введённые данные', fields);

    return withTransaction(db, () => {
      if (addressesRepo.countByUser(db, userId) >= MAX_ADDRESSES) {
        throw new ValidationError(`Можно сохранить не больше ${MAX_ADDRESSES} адресов. Удалите ненужный.`, { address: ['Достигнут лимит адресов'] });
      }
      const id = addressesRepo.insert(db, { userId, label: label || null, address, now: opts.now ?? Date.now() });
      return addressesRepo.listByUser(db, userId).find((a) => a.id === id)!;
    });
  },

  /** Чужой или несуществующий адрес → 404. */
  remove(userId: number, id: number, opts: { db?: Db } = {}): void {
    if (!Number.isInteger(id) || !addressesRepo.delete(opts.db ?? getDb(), userId, id)) throw new NotFoundError('Адрес не найден');
  },
};
