import { describe, expect, it } from 'vitest';
import { addresses, MAX_ADDRESSES } from '@/domain/customers/addresses';
import { profile } from '@/domain/customers/profile';
import { usersRepo } from '@/server/db/repositories/users';
import { NotFoundError, ValidationError } from '@/server/http/errors';
import { T0, setupDb } from '../ordering/helpers';

function newUser(db: ReturnType<typeof setupDb>, email = 'u@example.test'): number {
  return usersRepo.insert(db, { email, passwordHash: 'x', now: T0 });
}

describe('профиль', () => {
  it('сохраняет имя и телефон, нормализует пробелы; пустое значение очищает поле', () => {
    const db = setupDb();
    const id = newUser(db);
    expect(profile.get(id, { db })).toEqual({ email: 'u@example.test', name: null, phone: null });
    profile.update(id, { name: '  Иван   Петров ', phone: '8 (900) 111-22-33' }, { db, now: T0 });
    expect(profile.get(id, { db })).toEqual({ email: 'u@example.test', name: 'Иван Петров', phone: '+7 900 111-22-33' });
    profile.update(id, { name: '', phone: '' }, { db, now: T0 });
    expect(profile.get(id, { db })).toMatchObject({ name: null, phone: null });
  });

  it('серверная валидация: короткое имя, мусорный телефон — ошибки по полям, данные не меняются', () => {
    const db = setupDb();
    const id = newUser(db);
    profile.update(id, { name: 'Иван', phone: '+7 900 111-22-33' }, { db, now: T0 });
    let err: unknown;
    try {
      profile.update(id, { name: 'И', phone: '12' }, { db, now: T0 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect(Object.keys((err as ValidationError).fields).sort()).toEqual(['name', 'phone']);
    expect(profile.get(id, { db })).toMatchObject({ name: 'Иван' });
  });
});

describe('адреса', () => {
  it('добавляет и удаляет; адрес другого пользователя удалить нельзя (404)', () => {
    const db = setupDb();
    const me = newUser(db);
    const other = newUser(db, 'o@example.test');
    const a1 = addresses.add(me, { label: 'Дача', address: 'г. Москва, ул. Садовая, д. 5' }, { db, now: T0 }).id;
    addresses.add(me, { label: '', address: 'г. Тверь, ул. Лесная, 1' }, { db, now: T0 + 1 });
    expect(addresses.list(me, { db }).map((a) => a.label)).toEqual(['Дача', null]);
    expect(addresses.list(other, { db })).toEqual([]);

    expect(() => addresses.remove(other, a1, { db })).toThrow(NotFoundError);
    expect(addresses.list(me, { db })).toHaveLength(2);
    addresses.remove(me, a1, { db });
    expect(addresses.list(me, { db })).toHaveLength(1);
  });

  it('валидация: слишком короткий адрес, слишком длинный, лимит количества', () => {
    const db = setupDb();
    const me = newUser(db);
    expect(() => addresses.add(me, { label: '', address: 'ул' }, { db, now: T0 })).toThrow(ValidationError);
    expect(() => addresses.add(me, { label: 'x'.repeat(61), address: 'г. Москва, ул. Садовая, 5' }, { db, now: T0 })).toThrow(ValidationError);
    expect(() => addresses.add(me, { label: '', address: 'а'.repeat(301) }, { db, now: T0 })).toThrow(ValidationError);
    for (let i = 0; i < MAX_ADDRESSES; i++) addresses.add(me, { label: '', address: `г. Москва, ул. Садовая, ${i + 1}` }, { db, now: T0 });
    expect(() => addresses.add(me, { label: '', address: 'г. Москва, ул. Лишняя, 99' }, { db, now: T0 })).toThrow(ValidationError);
  });
});
