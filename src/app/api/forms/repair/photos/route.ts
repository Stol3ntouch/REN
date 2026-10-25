import { submitRepairPhotos, PUBLIC_PHOTO_MAX_FILES } from '@/domain/requests/repair-photos';
import { AppError, toErrorResponse, ValidationError } from '@/server/http/errors';
import { assertOrigin } from '@/server/http/origin';
import { clientIp } from '@/server/http/rate-limit';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 6 * 1024 * 1024 * PUBLIC_PHOTO_MAX_FILES;

/**
 * POST /api/forms/repair/photos — multipart: number, token (из ответа формы заявки) и файлы photo (до 5, JPEG/PNG/WebP).
 * Origin и лимит по IP; проверка содержимого файлов — в src/media. Чужие номера и неверная подпись → 404.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    assertOrigin(req);
    const length = Number(req.headers.get('content-length') ?? '0');
    if (length > MAX_BODY_BYTES) throw new AppError('Слишком большой запрос', 413, 'payload_too_large');
    const form = await req.formData().catch(() => {
      throw new ValidationError('Не удалось прочитать форму');
    });
    const files: Uint8Array[] = [];
    for (const f of form.getAll('photo')) {
      if (f instanceof File && f.size > 0) files.push(new Uint8Array(await f.arrayBuffer()));
    }
    const number = form.get('number');
    const token = form.get('token');
    const res = await submitRepairPhotos(
      { number: typeof number === 'string' ? number : '', token: typeof token === 'string' ? token : '', files },
      { ip: clientIp(req.headers) },
    );
    return Response.json({ ok: true, added: res.added }, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return toErrorResponse(e);
  }
}
