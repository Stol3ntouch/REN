/** Помощники CSV-тестов: кодирование в windows-1251 (в Node есть только декодер) и сборка файла. */
const CP1251_EXTRA: Record<string, number> = { Ё: 0xa8, ё: 0xb8, '№': 0xb9, '«': 0xab, '»': 0xbb, '—': 0x97, '–': 0x96 };

export function encodeCp1251(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) out.push(code);
    else if (CP1251_EXTRA[ch] !== undefined) out.push(CP1251_EXTRA[ch]!);
    else if (code >= 0x410 && code <= 0x44f) out.push(code - 0x410 + 0xc0);
    else throw new Error(`Нет в windows-1251: ${ch}`);
  }
  return Uint8Array.from(out);
}

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
export const utf8Bom = (text: string): Uint8Array => Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8(text)]);

/** CSV из массива строк. */
export const csv = (rows: string[][], delimiter = ';'): string => rows.map((r) => r.map((c) => (/[";\n\r,\t]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(delimiter)).join('\r\n') + '\r\n';
