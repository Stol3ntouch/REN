import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { defaultUploadsDir, ImageStoreError, storeImage } from '@/media/store-image';
import { sniffImageMime } from '@/media/signature';
import { ValidationError } from '@/server/http/errors';

/**
 * Загрузка логотипа и favicon страницы «Настройки магазина» — через защищённый механизм медиа:
 * тип определяется по содержимому (не по расширению и не по заголовку), картинка перекодируется,
 * имя файла случайное, файл лежит в каталоге загрузок и отдаётся только маршрутом /api/catalog/media.
 * SVG принимается как исходник для растеризации в PNG: сам SVG на сайт не попадает, скрипты и внешние ссылки отвергаются.
 */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const FAVICON_MAX_BYTES = 512 * 1024;
const FAVICON_SIZE = 64;
const MAX_PIXELS = 50_000_000;

export type MediaKind = 'logo' | 'favicon';

const fail = (kind: MediaKind, message: string): never => {
  throw new ValidationError(message, { [kind]: [message] });
};

const isIco = (b: Uint8Array): boolean => b.length >= 22 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 && (b[4] ?? 0) > 0 && b[5] === 0;

/** SVG — текстовый документ с корнем <svg>; без скриптов, внешних ссылок, встроенных документов и сущностей. */
export function looksLikeSvg(b: Uint8Array): boolean {
  const head = Buffer.from(b.subarray(0, 2048)).toString('utf8').replace(/^﻿/, '');
  return /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head);
}

export function assertSafeSvg(b: Uint8Array): void {
  const text = Buffer.from(b).toString('utf8');
  if (/<\s*(script|foreignObject|iframe|image|use|style|animate|set)\b|<!ENTITY|<!DOCTYPE|\son[a-z]+\s*=|javascript:/i.test(text)) {
    throw new Error('unsafe');
  }
  if (/(?:xlink:)?href\s*=\s*["']\s*(?!#)/i.test(text)) throw new Error('unsafe');
}

async function rasterizeSvg(b: Uint8Array, width: number): Promise<Uint8Array> {
  try {
    assertSafeSvg(b);
    return await sharp(Buffer.from(b), { density: 192, limitInputPixels: MAX_PIXELS }).resize({ width, withoutEnlargement: false }).png().toBuffer();
  } catch {
    throw new Error('svg');
  }
}

/** Логотип: PNG, JPG, WebP или SVG, до 2 МБ. Возвращает путь файла в каталоге загрузок. */
export async function intakeLogo(bytes: Uint8Array, dir?: string): Promise<string> {
  if (bytes.byteLength === 0) fail('logo', 'Файл логотипа пустой');
  if (bytes.byteLength > LOGO_MAX_BYTES) fail('logo', 'Логотип больше 2 МБ');
  let source = bytes;
  if (!sniffImageMime(bytes)) {
    if (!looksLikeSvg(bytes)) return fail('logo', 'Логотип должен быть изображением PNG, JPG, WebP или SVG');
    try {
      source = await rasterizeSvg(bytes, 960);
    } catch {
      return fail('logo', 'SVG небезопасен или не читается: уберите скрипты и внешние ссылки либо загрузите PNG');
    }
  }
  try {
    const stored = await storeImage(source, { dir });
    return (stored.variants.find((v) => v.key === 'card') ?? stored.variants.at(-1))?.path ?? stored.path;
  } catch (e) {
    if (e instanceof ImageStoreError) return fail('logo', e.message);
    throw e;
  }
}

/** Favicon: PNG, ICO, JPG, WebP или SVG, до 512 КБ. PNG/SVG приводятся к PNG 64×64; ICO проверяется по заголовку и хранится как есть. */
export async function intakeFavicon(bytes: Uint8Array, dir?: string): Promise<string> {
  if (bytes.byteLength === 0) fail('favicon', 'Файл favicon пустой');
  if (bytes.byteLength > FAVICON_MAX_BYTES) fail('favicon', 'Favicon больше 512 КБ');
  const root = dir ?? defaultUploadsDir();
  const id = randomBytes(16).toString('hex');
  if (isIco(bytes)) {
    await mkdir(root, { recursive: true });
    const name = `favicon-${id}.ico`;
    await writeFile(join(root, name), bytes, { flag: 'wx' });
    return name;
  }
  let source = bytes;
  if (!sniffImageMime(bytes)) {
    if (!looksLikeSvg(bytes)) return fail('favicon', 'Favicon должен быть PNG, ICO, JPG, WebP или SVG');
    try {
      source = await rasterizeSvg(bytes, FAVICON_SIZE * 4);
    } catch {
      return fail('favicon', 'SVG небезопасен или не читается: загрузите PNG');
    }
  }
  let png: Buffer;
  try {
    png = await sharp(Buffer.from(source), { limitInputPixels: MAX_PIXELS, failOn: 'error' })
      .rotate()
      .resize(FAVICON_SIZE, FAVICON_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  } catch {
    return fail('favicon', 'Изображение повреждено или не читается');
  }
  await mkdir(root, { recursive: true });
  const name = `favicon-${id}.png`;
  await writeFile(join(root, name), png, { flag: 'wx' });
  return name;
}

/** Изображение Open Graph по умолчанию: JPG, PNG или WebP до 5 МБ; хранится крупный вариант (до 1600 px). */
export async function intakeOgImage(bytes: Uint8Array, dir?: string): Promise<string> {
  if (bytes.byteLength === 0) throw new ValidationError('Файл изображения пустой', { ogImage: ['Файл пустой'] });
  try {
    const stored = await storeImage(bytes, { dir });
    return stored.path;
  } catch (e) {
    if (e instanceof ImageStoreError) throw new ValidationError(e.message, { ogImage: [e.message] });
    throw e;
  }
}
