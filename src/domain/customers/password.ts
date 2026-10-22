import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

// Параметры scrypt (OWASP: N=2^15..2^17 для интерактивных; берём 2^15, r=8, p=1 — ~50-100 мс).
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const opts: ScryptOptions = { N: n, r, p, maxmem: 256 * n * r };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEYLEN, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Формат: scrypt$N$r$p$соль(base64)$хеш(base64). Параметры в строке позволяют менять их позже. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** true только для верного пароля; повреждённая строка хеша → false. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const nn = Number(n);
  const rr = Number(r);
  const pp = Number(p);
  if (![nn, rr, pp].every((v) => Number.isInteger(v) && v > 0) || nn > 1 << 20 || (nn & (nn - 1)) !== 0) return false;
  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length !== KEYLEN) return false;
  try {
    const actual = await derive(password, Buffer.from(saltB64, 'base64'), nn, rr, pp);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Заготовка для выравнивания времени ответа при неизвестном email. */
let dummy: Promise<string> | undefined;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword('dummy-password-for-timing');
  return dummy;
}
