import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImageStoreError, storeImage } from '@/media/store-image';
import { sniffImageMime } from '@/media/signature';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'rts-img-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const raw = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 30 } } });

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ImageStoreError) return e.code;
    throw e;
  }
  return 'ok';
}

describe('storeImage', () => {
  it('сохраняет JPEG под случайным именем и режет на варианты размеров', async () => {
    const jpeg = await raw(2000, 1500).jpeg().toBuffer();
    const r = await storeImage(jpeg, { dir });
    expect(r.width).toBe(1600); // крупнее 1600 уменьшаем
    expect(r.variants.map((v) => v.key)).toEqual(['thumb', 'card', 'large', 'full']);
    expect(r.variants.map((v) => v.width)).toEqual([160, 480, 960, 1600]);
    expect(r.variants.map((v) => v.height)).toEqual([120, 360, 720, 1200]); // пропорции сохранены
    expect(r.path).toBe(r.variants.at(-1)?.path);
    for (const v of r.variants) {
      expect(existsSync(join(dir, v.path))).toBe(true);
      expect(sniffImageMime(readFileSync(join(dir, v.path)))).toBe('image/webp'); // перекодировано
    }
  });

  it('имя случайное, не зависит от входа и не выходит из каталога', async () => {
    const jpeg = await raw(300, 300).jpeg().toBuffer();
    const a = await storeImage(jpeg, { dir });
    const b = await storeImage(jpeg, { dir });
    expect(a.path).not.toBe(b.path);
    expect(a.path).toMatch(/^[a-f0-9]{32}-\d+\.webp$/);
    expect(a.path).not.toMatch(/[\\/]|\.\./);
  });

  it('не увеличивает маленькие картинки: лишние варианты пропускаются', async () => {
    const png = await raw(200, 100).png().toBuffer();
    const r = await storeImage(png, { dir });
    expect(r.variants.map((v) => v.key)).toEqual(['thumb', 'full']);
    expect(r.width).toBe(200);
    expect(r.height).toBe(100);
  });

  it('принимает PNG и WebP', async () => {
    expect((await storeImage(await raw(64, 64).png().toBuffer(), { dir })).variants.length).toBeGreaterThan(0);
    expect((await storeImage(await raw(64, 64).webp().toBuffer(), { dir })).variants.length).toBeGreaterThan(0);
  });

  it('вырезает метаданные (EXIF/GPS) из результата', async () => {
    const withExif = await raw(300, 300).withExif({ IFD0: { Copyright: 'secret-owner' } }).jpeg().toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const r = await storeImage(withExif, { dir });
    const out = readFileSync(join(dir, r.path));
    expect((await sharp(out).metadata()).exif).toBeUndefined();
    expect(out.includes(Buffer.from('secret-owner'))).toBe(false);
  });

  it('«jpg» с HTML внутри отклоняется по сигнатуре', async () => {
    const html = Buffer.from('<html><body><script>alert(1)</script></body></html>');
    expect(await codeOf(storeImage(html, { dir }))).toBe('not_image');
    expect(await codeOf(storeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>'), { dir }))).toBe('not_image');
    expect(await codeOf(storeImage(Buffer.from('GIF89a....'), { dir }))).toBe('not_image'); // gif вне списка
    expect(await codeOf(storeImage(Buffer.alloc(0), { dir }))).toBe('not_image');
  });

  it('верная сигнатура, но мусор внутри — отклоняется при декодировании, файлов не остаётся', async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('<script>alert(1)</script>')]);
    const before = readdirSync(dir).length;
    expect(await codeOf(storeImage(fake, { dir }))).toBe('corrupt');
    expect(readdirSync(dir).length).toBe(before);
  });

  it('файл больше 5 МБ отклоняется', async () => {
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5 * 1024 * 1024)]);
    expect(await codeOf(storeImage(big, { dir }))).toBe('too_large');
  });
});
