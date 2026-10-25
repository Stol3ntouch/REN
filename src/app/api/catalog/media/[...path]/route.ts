import { readFile, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';

const TYPES: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', ico: 'image/x-icon' };
/** Каталог загрузок: DATA_DIR/uploads (как в media/store-image; не импортируем sharp ради одного пути). */
const uploadsDir = () => join(/*turbopackIgnore: true*/ process.env.DATA_DIR?.trim() || 'data', 'uploads');
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * GET /api/catalog/media/<путь внутри DATA_DIR/uploads> — отдаёт сохранённые фото товаров.
 * Только изображения; сегменты пути проверяются (без «..», слэшей и скрытых файлов), итоговый
 * путь обязан лежать внутри каталога загрузок. Имена случайные и неизменные — кэш на год.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const ext = path.at(-1)?.split('.').pop()?.toLowerCase() ?? '';
  if (path.length === 0 || path.length > 4 || !path.every((s) => SEGMENT.test(s) && !s.includes('..')) || !TYPES[ext]) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const root = await realpath(/*turbopackIgnore: true*/ uploadsDir());
    const file = await realpath(join(/*turbopackIgnore: true*/ root, ...path));
    if (!file.startsWith(root + sep)) return new Response('Not found', { status: 404 });
    const data = await readFile(/*turbopackIgnore: true*/ file);
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': TYPES[ext] as string, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
