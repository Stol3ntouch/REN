import { isIP } from 'node:net';

/** Разбор IPv4 в четыре октета; null, если это не IPv4. */
function parseV4(ip: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return parts as [number, number, number, number];
}

function isPrivateV4([a, b, c]: [number, number, number, number]): boolean {
  return (
    a === 0 || // «эта сеть»
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a === 127 ||
    (a === 169 && b === 254) || // link-local, метаданные облака
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast, зарезервированные, broadcast
  );
}

/** Разворачивает IPv6 в восемь 16-битных групп; null при ошибке разбора. */
function expandV6(ip: string): number[] | null {
  let s = ip.split('%')[0] ?? ''; // zone id
  const tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (tail) {
    const v4 = parseV4(tail[1] as string);
    if (!v4) return null;
    s = s.slice(0, s.length - (tail[1] as string).length) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...rest].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * true, если адрес нельзя использовать для исходящего запроса: loopback, частные, link-local,
 * CGNAT, multicast, зарезервированные, а также любая строка, которая не является IP-адресом.
 */
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '');
  const kind = isIP(ip);
  if (kind === 4) {
    const v4 = parseV4(ip);
    return v4 ? isPrivateV4(v4) : true;
  }
  if (kind !== 6) return true;
  const g = expandV6(ip);
  if (!g) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  const embedded: [number, number, number, number] = [g6 >> 8, g6 & 255, g7 >> 8, g7 & 255];
  if (g.every((x) => x === 0)) return true; // ::
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) и IPv4-compatible (::a.b.c.d): проверяем вложенный IPv4
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) return isPrivateV4(embedded);
  // NAT64 (64:ff9b::/96)
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isPrivateV4(embedded);
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (устаревший)
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // документация
  if (g0 === 0x2002) return isPrivateV4([g1 >> 8, g1 & 255, g2 >> 8, g2 & 255]); // 6to4
  return false;
}
