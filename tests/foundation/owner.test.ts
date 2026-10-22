import { describe, expect, it } from 'vitest';
import { GUEST_COOKIE, createGuestId, getOrCreateOwnerRef, getOwnerRef } from '@/server/http/owner';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fakeStore(initial: Record<string, string> = {}) {
  const jar = new Map(Object.entries(initial));
  const sets: { name: string; value: string; options?: Record<string, unknown> }[] = [];
  return {
    sets,
    get: (name: string) => (jar.has(name) ? { value: jar.get(name)! } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      jar.set(name, value);
      sets.push({ name, value, options });
    },
  };
}

describe('guest owner', () => {
  it('имя cookie — rts_guest', () => {
    expect(GUEST_COOKIE).toBe('rts_guest');
  });

  it('createGuestId выдаёт уникальные UUID', () => {
    const a = createGuestId();
    expect(a).toMatch(UUID);
    expect(createGuestId()).not.toBe(a);
  });

  it('getOwnerRef: нет cookie → null, валидный → гость, мусор → null', () => {
    expect(getOwnerRef(fakeStore())).toBeNull();
    const id = '3f2b8c1e-5a77-4d2f-9c0e-1a2b3c4d5e6f';
    expect(getOwnerRef(fakeStore({ [GUEST_COOKIE]: id }))).toEqual({ kind: 'guest', guestId: id });
    expect(getOwnerRef(fakeStore({ [GUEST_COOKIE]: "x'; drop table cart;--" }))).toBeNull();
  });

  it('getOrCreateOwnerRef создаёт httpOnly cookie один раз', () => {
    const store = fakeStore();
    const first = getOrCreateOwnerRef(store);
    expect(first.kind).toBe('guest');
    expect(store.sets).toHaveLength(1);
    expect(store.sets[0]).toMatchObject({
      name: 'rts_guest',
      options: { httpOnly: true, sameSite: 'lax', path: '/' },
    });
    expect(store.sets[0]!.options!.maxAge).toBeGreaterThan(86400);

    const second = getOrCreateOwnerRef(store);
    expect(second).toEqual(first);
    expect(store.sets).toHaveLength(1);
  });

  it('заменяет испорченный cookie новым', () => {
    const store = fakeStore({ [GUEST_COOKIE]: 'garbage' });
    const owner = getOrCreateOwnerRef(store);
    expect(owner.kind === 'guest' && owner.guestId).toMatch(UUID);
    expect(store.sets).toHaveLength(1);
  });
});
