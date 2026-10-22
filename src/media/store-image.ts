import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { MAX_IMAGE_BYTES } from './safe-fetch';
import { sniffImageMime } from './signature';

export type ImageStoreErrorCode = 'not_image' | 'too_large' | 'corrupt';

export class ImageStoreError extends Error {
  constructor(
    public code: ImageStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ImageStoreError';
  }
}

/** Файл варианта; path — относительно каталога загрузок (data/uploads). */
export type ImageVariant = { key: string; width: number; height: number; path: string };
export type StoredImage = {
  /** Основной (самый крупный) вариант. */
  path: string;
  variants: ImageVariant[];
  width: number;
  height: number;
};

const VARIANT_WIDTHS = [
  { key: 'thumb', width: 160 },
  { key: 'card', width: 480 },
  { key: 'large', width: 960 },
] as const;
const FULL = { key: 'full', width: 1600 } as const;
const MAX_PIXELS = 50_000_000;

/** Каталог загрузок: DATA_DIR/uploads (DATA_DIR по умолчанию data). */
export function defaultUploadsDir(): string {
  return join(process.env.DATA_DIR?.trim() || 'data', 'uploads');
}

/**
 * Принимает байты изображения: проверяет сигнатуру (jpeg/png/webp, не расширение), декодирует,
 * перекодирует в WebP без метаданных и сохраняет варианты размеров под случайным именем.
 * Увеличения не делает: варианты шире оригинала пропускаются.
 */
export async function storeImage(bytes: Uint8Array, opts: { dir?: string } = {}): Promise<StoredImage> {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ImageStoreError('too_large', 'Файл больше 5 МБ');
  if (!sniffImageMime(bytes)) throw new ImageStoreError('not_image', 'Файл не является изображением JPEG, PNG или WebP');

  const dir = opts.dir ?? defaultUploadsDir();
  const source = Buffer.from(bytes);
  let sourceWidth: number;
  const rendered: { key: string; width: number; height: number; data: Buffer }[] = [];
  try {
    const meta = await sharp(source, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).metadata();
    sourceWidth = meta.autoOrient?.width ?? meta.width ?? 0;
    if (!sourceWidth) throw new Error('no width');
    const widths = [...VARIANT_WIDTHS.filter((v) => v.width < sourceWidth), { key: FULL.key, width: Math.min(FULL.width, sourceWidth) }];
    for (const v of widths) {
      // rotate() применяет EXIF-ориентацию; метаданные sharp по умолчанию не переносит.
      const { data, info } = await sharp(source, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
        .rotate()
        .resize({ width: v.width, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      rendered.push({ key: v.key, width: info.width, height: info.height, data });
    }
  } catch {
    throw new ImageStoreError('corrupt', 'Изображение повреждено или не читается');
  }

  const id = randomBytes(16).toString('hex');
  await mkdir(dir, { recursive: true });
  const variants: ImageVariant[] = rendered.map((r) => ({ key: r.key, width: r.width, height: r.height, path: `${id}-${r.width}.webp` }));
  try {
    for (const [i, v] of variants.entries()) await writeFile(join(dir, v.path), (rendered[i] as (typeof rendered)[number]).data, { flag: 'wx' });
  } catch (e) {
    await Promise.all(variants.map((v) => rm(join(dir, v.path), { force: true })));
    throw e;
  }
  const full = variants.at(-1) as ImageVariant;
  return { path: full.path, variants, width: full.width, height: full.height };
}
