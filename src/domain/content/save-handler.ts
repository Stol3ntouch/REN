import { withStaffPermission } from '@/domain/admin/guard';
import { parseRubles } from '@/domain/pricing/format';
import type { Db } from '@/server/db/connection';
import { AppError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/server/http/errors';
import { ENTITY_FIELDS, OPS_KEY, isEntityKey, type EntityKey, type FieldSpec } from './fields';
import { contentOps, type Ctx, type ImageInput } from './ops';

/**
 * Обработчик сохранения форм админки «Контент»: POST /admin/content/save/<раздел>.
 * multipart/form-data (так форма может нести файл, без лимита server actions). Защита: Origin → сессия → право
 * content.write — withStaffPermission; сами операции проверяют право ещё раз.
 * Успех и понятные ошибки формы — редирект 303 обратно в раздел (?ok=1 / ?error=…); админка переводит
 * ?edit=<id> и ?new=1 на страницы правки и создания.
 */
export type SaveHandlerDeps = { db?: Db; now?: number; uploadsDir?: string };
export type SaveRouteContext = { params: Promise<{ entity: string }> };

const MAX_BODY_BYTES = 14_000_000;
const MSK_OFFSET = '+03:00';
const DAY_MS = 86_400_000;

const isFile = (v: unknown): v is File => typeof File !== 'undefined' && v instanceof File;
const bad = (f: FieldSpec, msg: string): never => {
  throw new ValidationError(`«${f.label}»: ${msg}`, { [f.name]: [msg] });
};

async function readField(form: FormData, f: FieldSpec): Promise<unknown> {
  const raw = form.get(f.name);
  const text = typeof raw === 'string' ? raw.trim() : '';
  switch (f.kind) {
    case 'bool':
      return raw === 'on' || raw === 'true' || raw === '1';
    case 'int': {
      if (text === '') return null;
      const n = Number(text);
      return Number.isFinite(n) ? n : bad(f, 'нужно число');
    }
    case 'refselect': {
      if (raw === null) return undefined;
      if (text === '') return null;
      return /^\d+$/.test(text) ? Number(text) : bad(f, 'неверное значение');
    }
    case 'intlist': {
      if (form.get(`${f.name}__present`) === null) return undefined;
      const ids = form.getAll(f.name).map((v) => (typeof v === 'string' ? v.trim() : ''));
      if (ids.some((v) => !/^\d+$/.test(v))) return bad(f, 'неверное значение');
      return ids.map(Number);
    }
    case 'money': {
      if (text === '') return null;
      const k = parseRubles(text);
      return k === null ? bad(f, 'сумма в рублях, например 500 или 500,50') : k;
    }
    case 'date': {
      if (text === '') return null;
      const t = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00${MSK_OFFSET}`) : NaN;
      if (Number.isNaN(t)) return bad(f, 'неверная дата');
      return f.endOfDay ? t + DAY_MS - 1 : t;
    }
    case 'datetime': {
      if (text === '') return null;
      const t = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text) ? Date.parse(`${text}:00${MSK_OFFSET}`) : NaN;
      return Number.isNaN(t) ? bad(f, 'неверные дата и время') : t;
    }
    case 'file': {
      const input: ImageInput = {};
      if (isFile(raw) && raw.size > 0) input.bytes = new Uint8Array(await raw.arrayBuffer());
      if (form.get(`${f.name}Remove`) === 'on' || form.get(`${f.name}_clear`) === '1') input.remove = true;
      return input;
    }
    case 'select':
      return text === '' ? undefined : text;
    default:
      return typeof raw === 'string' ? raw : undefined;
  }
}

async function readForm(form: FormData, entity: EntityKey): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const f of ENTITY_FIELDS[entity]) {
    const v = await readField(form, f);
    if (f.kind === 'file') out[f.name] = v;
    else if (v !== undefined) out[f.name] = v;
  }
  if (entity === 'promotions' && typeof out.discountValue === 'string') {
    // размер скидки: процент — целое, сумма — рубли → копейки
    const v = out.discountValue.trim();
    const field = ENTITY_FIELDS.promotions.find((x) => x.name === 'discountValue') as FieldSpec;
    if (v === '') out.discountValue = 0;
    else if (out.discountType === 'percent') out.discountValue = /^\d{1,3}$/.test(v) ? Number(v) : bad(field, 'процент — целое число от 1 до 99');
    else out.discountValue = parseRubles(v) ?? bad(field, 'сумма в рублях, например 500 или 500,50');
  }
  return out;
}

const section = (entity: EntityKey) => `/admin/content/${entity}`;
const redirect = (location: string): Response => new Response(null, { status: 303, headers: { Location: location } });

export function createContentSaveHandler(deps: SaveHandlerDeps = {}) {
  const ctx: Ctx = { db: deps.db, now: deps.now, uploadsDir: deps.uploadsDir };
  return async (req: Request, route: SaveRouteContext): Promise<Response> => {
    const { entity } = await route.params;
    const guarded = withStaffPermission(
      'content.write',
      async (r, session) => {
        if (!isEntityKey(entity)) throw new NotFoundError('Раздел не найден');
        if (Number(r.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) throw new ValidationError('Файл слишком большой (до 5 МБ)');
        const form = await r.formData();
        const idRaw = form.get('id');
        const id = typeof idRaw === 'string' && /^\d+$/.test(idRaw) ? Number(idRaw) : null;
        try {
          const ops = contentOps[OPS_KEY[entity]];
          if (form.get('_action') === 'delete') {
            if (id === null || entity === 'settings') throw new ValidationError('Это действие недоступно');
            await (ops as unknown as { remove(s: typeof session, id: number, c: Ctx): Promise<void> }).remove(session, id, ctx);
            return redirect(`${section(entity)}?ok=1`);
          }
          const values = await readForm(form, entity);
          if (entity === 'settings') {
            const { logo, ...rest } = values;
            await contentOps.settings.save(session, { ...(rest as Record<string, string>), logo: logo as ImageInput }, ctx);
            return redirect(`${section(entity)}?ok=1`);
          }
          // тип входа зависит от раздела: форма собрана по тому же описанию полей, zod проверит внутри операции
          const saved = await (ops as unknown as { save(s: typeof session, id: number | null, v: never, c: Ctx): Promise<{ id: number }> }).save(session, id, values as never, ctx);
          return redirect(`${section(entity)}?ok=1&edit=${saved.id}`);
        } catch (e) {
          if (e instanceof ForbiddenError || e instanceof UnauthorizedError) throw e;
          if (e instanceof AppError && e.status < 500) {
            const back = id === null ? 'new=1' : `edit=${id}`;
            return redirect(`${section(entity)}?error=${encodeURIComponent(e.message)}&${back}`);
          }
          throw e;
        }
      },
      { db: deps.db, now: deps.now },
    );
    return guarded(req);
  };
}
