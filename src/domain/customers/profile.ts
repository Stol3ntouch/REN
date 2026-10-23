import { phoneDigits } from '@/domain/ordering/contact';
import { getDb, type Db } from '@/server/db/connection';
import { profilesRepo } from '@/server/db/repositories/addresses';
import { usersRepo } from '@/server/db/repositories/users';
import { NotFoundError, ValidationError, type FieldErrors } from '@/server/http/errors';

export type Profile = { email: string; name: string | null; phone: string | null };
export type ProfileInput = { name: string; phone: string };

/** Телефон в едином виде: российский — «+7 900 111-22-33», иной международный — «+» и цифры. */
export function formatPhone(digits: string): string {
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith('7')) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }
  return `+${digits}`;
}

export const profile = {
  get(userId: number, opts: { db?: Db } = {}): Profile {
    const db = opts.db ?? getDb();
    const user = usersRepo.findById(db, userId);
    if (!user) throw new NotFoundError('Профиль не найден');
    const p = profilesRepo.find(db, userId);
    return { email: user.email, name: p?.name ?? null, phone: p?.phone ?? null };
  },

  /** Имя (2–100 символов) и телефон (10–15 цифр) необязательны: пустая строка очищает поле. Проверка — на сервере. */
  update(userId: number, input: ProfileInput, opts: { db?: Db; now?: number } = {}): Profile {
    const db = opts.db ?? getDb();
    const fields: FieldErrors = {};
    const rawName = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : '';
    const rawPhone = typeof input.phone === 'string' ? input.phone.trim() : '';

    let name: string | null = null;
    if (rawName !== '') {
      if (rawName.length < 2) fields.name = ['Имя не короче 2 символов'];
      else if (rawName.length > 100) fields.name = ['Имя не длиннее 100 символов'];
      else name = rawName;
    }
    let phone: string | null = null;
    if (rawPhone !== '') {
      const digits = phoneDigits(rawPhone);
      if (rawPhone.length > 30 || digits.length < 10 || digits.length > 15) fields.phone = ['Введите телефон полностью, например +7 900 000-00-00'];
      else phone = formatPhone(digits);
    }
    if (Object.keys(fields).length > 0) throw new ValidationError('Проверьте введённые данные', fields);

    if (!usersRepo.findById(db, userId)) throw new NotFoundError('Профиль не найден');
    profilesRepo.upsert(db, { userId, name, phone, now: opts.now ?? Date.now() });
    return profile.get(userId, { db });
  },
};
