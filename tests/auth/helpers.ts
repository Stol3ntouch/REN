/** Поддельное хранилище cookies для тестов (в стиле tests/foundation/owner.test.ts). */
export type SetCall = { name: string; value: string; options?: Record<string, unknown> };

export function fakeCookies(initial: Record<string, string> = {}) {
  const jar = new Map(Object.entries(initial));
  const sets: SetCall[] = [];
  return {
    jar,
    sets,
    get: (name: string) => (jar.has(name) ? { value: jar.get(name)! } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      if (value === '' || (options && options.maxAge === 0)) jar.delete(name);
      else jar.set(name, value);
      sets.push({ name, value, options });
    },
  };
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);
