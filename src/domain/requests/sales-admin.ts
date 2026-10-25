import { audit } from '@/domain/admin/audit';
import { enqueueMail } from '@/domain/admin/mail-enqueue';
import { requirePermission, type StaffSession } from '@/domain/admin/permissions';
import { ImageStoreError, storeImage } from '@/media';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { requestsRepo, type RequestCommentRow, type RequestEventRow, type RequestKind, type RequestPhotoRow, type RequestRow, type RequestStatus } from '@/server/db/repositories/requests';
import { staffRepo } from '@/server/db/repositories/staff';
import { ConflictError, NotFoundError, ValidationError } from '@/server/http/errors';
import { normalizePhone } from './schemas';
import {
  INQUIRY_CHANNELS,
  INQUIRY_STATUSES,
  REPAIR_PHOTO_LIMIT,
  REPAIR_STATUSES,
  canInquiryTransition,
  canRepairTransition,
  isInquiryChannel,
  isInquiryStatus,
  isRepairStatus,
  statusLabel,
} from './workflow';

type Opts = { db?: Db; now?: number };
export const REQUESTS_PAGE_SIZES = [20, 50, 100] as const;
const COMMENT_MAX = 2000;
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

export type RequestFilters = {
  q?: string;
  status?: RequestStatus;
  channel?: RequestKind;
  assignedStaffId?: number | 'none';
  from?: number;
  to?: number;
  sort?: 'created' | 'number' | 'status' | 'name';
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
};

function dayStart(v: unknown): number | undefined {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const t = Date.parse(`${v}T00:00:00+03:00`);
  return Number.isNaN(t) ? undefined : t;
}

/** Фильтры из адресной строки (для обращений и ремонта): лишнее и неверное отбрасывается. */
export function parseRequestFilters(sp: Record<string, unknown>, scope: 'inquiries' | 'repairs'): RequestFilters {
  const out: RequestFilters = {};
  const q = first(sp.q);
  if (typeof q === 'string' && q.trim()) out.q = q.trim().slice(0, 100);
  const status = first(sp.status);
  if (scope === 'inquiries' ? isInquiryStatus(status) : isRepairStatus(status)) out.status = status as RequestStatus;
  const channel = first(sp.channel);
  if (scope === 'inquiries' && isInquiryChannel(channel)) out.channel = channel;
  const as = first(sp.assigned);
  if (as === 'none') out.assignedStaffId = 'none';
  else if (typeof as === 'string' && /^\d{1,9}$/.test(as)) out.assignedStaffId = Number(as);
  const from = dayStart(first(sp.from));
  if (from !== undefined) out.from = from;
  const to = dayStart(first(sp.to));
  if (to !== undefined) out.to = to + 86_400_000;
  const sort = first(sp.sort);
  if (sort === 'created' || sort === 'number' || sort === 'status' || sort === 'name') out.sort = sort;
  const dir = first(sp.dir);
  if (dir === 'asc' || dir === 'desc') out.dir = dir;
  const size = Number(first(sp.pageSize));
  if ((REQUESTS_PAGE_SIZES as readonly number[]).includes(size)) out.pageSize = size;
  const page = Number(first(sp.page));
  out.page = Number.isInteger(page) && page >= 1 ? page : 1;
  return out;
}

export type RequestDetail = { request: RequestRow; comments: RequestCommentRow[]; events: RequestEventRow[]; photos: RequestPhotoRow[] };
export type RequestList = { rows: RequestRow[]; total: number; page: number; pageSize: number };

const textOf = (v: unknown, label: string, max = COMMENT_MAX): string => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t) throw new ValidationError(`${label}: заполните поле`);
  if (t.length > max) throw new ValidationError(`${label}: не длиннее ${max} символов`);
  return t;
};

/** Общая часть обращений и ремонта; scope задаёт набор видов, статусов и право. */
function makeOps(scope: 'inquiries' | 'repairs') {
  const kinds: readonly RequestKind[] = scope === 'repairs' ? ['repair'] : INQUIRY_CHANNELS;
  const readPerm = scope === 'repairs' ? 'repair.write' : 'inquiries.read';
  const writePerm = scope === 'repairs' ? 'repair.write' : 'inquiries.write';
  const entity = scope === 'repairs' ? 'repair' : 'inquiry';
  const allStatuses: readonly RequestStatus[] = scope === 'repairs' ? REPAIR_STATUSES : INQUIRY_STATUSES;

  /** Чужой раздел (ремонт в обращениях и наоборот) для вызывающего не существует: 404. */
  const load = (db: Db, id: number): RequestRow => {
    const r = Number.isInteger(id) ? requestsRepo.findById(db, id) : null;
    if (!r || !kinds.includes(r.kind)) throw new NotFoundError('Заявка не найдена');
    return r;
  };

  const assertTransition = (r: RequestRow, to: RequestStatus) => {
    if (!allStatuses.includes(to)) throw new ValidationError('Неизвестный статус');
    const ok = scope === 'repairs' ? isRepairStatus(r.status) && isRepairStatus(to) && canRepairTransition(r.status, to) : isInquiryStatus(r.status) && isInquiryStatus(to) && canInquiryTransition(r.status, to);
    if (!ok) throw new ConflictError(`Нельзя перевести из «${statusLabel(r.kind, r.status)}» в «${statusLabel(r.kind, to)}»`);
  };

  const changeStatus = (db: Db, session: StaffSession, r: RequestRow, to: RequestStatus, note: string | null, now: number): void => {
    assertTransition(r, to);
    requestsRepo.update(db, r.id, { status: to, handledBy: session.staffId, now });
    requestsRepo.insertEvent(db, { requestId: r.id, at: now, kind: 'status', fromStatus: r.status, toStatus: to, actorType: 'staff', actorId: String(session.staffId), note });
    audit.record(
      { actorId: session.staffId, actorType: 'staff', action: `${entity}.status`, entity, entityId: r.id, before: { number: r.number, status: r.status }, after: { status: to, note: note ?? undefined } },
      { db, now },
    );
  };

  return {
    list(session: StaffSession | null, f: RequestFilters, opts: Opts = {}): RequestList {
      requirePermission(session, readPerm);
      const db = opts.db ?? getDb();
      const pageSize = (REQUESTS_PAGE_SIZES as readonly number[]).includes(f.pageSize ?? 0) ? (f.pageSize as number) : 20;
      const page = Math.max(1, f.page ?? 1);
      const { rows, total } = requestsRepo.search(db, {
        kinds: f.channel && kinds.includes(f.channel) ? [f.channel] : kinds,
        statuses: f.status ? [f.status] : undefined,
        q: f.q,
        assignedStaffId: f.assignedStaffId,
        from: f.from,
        to: f.to,
        sort: f.sort,
        dir: f.dir,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      return { rows, total, page, pageSize };
    },

    /** null — нет такой заявки в этом разделе (страница отвечает 404). */
    get(session: StaffSession | null, id: number, opts: Opts = {}): RequestDetail | null {
      requirePermission(session, readPerm);
      const db = opts.db ?? getDb();
      const r = Number.isInteger(id) ? requestsRepo.findById(db, id) : null;
      if (!r || !kinds.includes(r.kind)) return null;
      return { request: r, comments: requestsRepo.listComments(db, id), events: requestsRepo.listEvents(db, id), photos: requestsRepo.listPhotos(db, id) };
    },

    staffForAssignment(session: StaffSession | null, opts: Opts = {}): Array<{ id: number; label: string }> {
      requirePermission(session, readPerm);
      return staffRepo
        .list(opts.db ?? getDb())
        .filter((s) => s.active)
        .map((s) => ({ id: s.id, label: s.name ?? s.email }));
    },

    setStatus(session: StaffSession | null, id: number, to: unknown, note: unknown, opts: Opts = {}): RequestRow {
      requirePermission(session, writePerm);
      const db = opts.db ?? getDb();
      const now = opts.now ?? Date.now();
      const n = typeof note === 'string' && note.trim() ? textOf(note, 'Комментарий') : null;
      let mail: { to: string; number: string; label: string; name: string; title: string | null } | null = null;
      const result = withTransaction(db, () => {
        const r = load(db, id);
        changeStatus(db, session, r, to as RequestStatus, n, now);
        const after = requestsRepo.findById(db, id)!;
        if (after.email) mail = { to: after.email, number: after.number, label: statusLabel(after.kind, after.status), name: after.name, title: after.subject ?? after.equipmentType };
        return after;
      });
      // письмо — через очередь; без настроенной почты оно просто ждёт в email_outbox
      const m = mail as { to: string; number: string; label: string; name: string; title: string | null } | null;
      if (m) enqueueMail('request.status_changed', { to: m.to, number: m.number, statusLabel: m.label, name: m.name, title: m.title ?? undefined, dedupe: `${m.number}:${result.status}:${now}` }, { db, now });
      return result;
    },

    assign(session: StaffSession | null, id: number, staffId: number | null, opts: Opts = {}): RequestRow {
      requirePermission(session, writePerm);
      const db = opts.db ?? getDb();
      const now = opts.now ?? Date.now();
      return withTransaction(db, () => {
        const r = load(db, id);
        if (staffId !== null) {
          const s = staffRepo.findById(db, staffId);
          if (!s || !s.active) throw new ValidationError('Сотрудник не найден или отключён');
        }
        if (r.assignedStaffId !== staffId) {
          requestsRepo.setAssigned(db, id, staffId, now);
          requestsRepo.insertEvent(db, { requestId: id, at: now, kind: 'assigned', actorType: 'staff', actorId: String(session.staffId), note: staffId === null ? 'Ответственный снят' : `Ответственный: сотрудник №${staffId}` });
          audit.record({ actorId: session.staffId, actorType: 'staff', action: `${entity}.assign`, entity, entityId: id, before: { assignedStaffId: r.assignedStaffId }, after: { assignedStaffId: staffId } }, { db, now });
        }
        return requestsRepo.findById(db, id)!;
      });
    },

    addComment(session: StaffSession | null, id: number, body: unknown, opts: Opts = {}): void {
      requirePermission(session, writePerm);
      const db = opts.db ?? getDb();
      const now = opts.now ?? Date.now();
      const text = textOf(body, 'Комментарий');
      withTransaction(db, () => {
        load(db, id);
        requestsRepo.insertComment(db, id, session.staffId, text, now);
        requestsRepo.insertEvent(db, { requestId: id, at: now, kind: 'comment', actorType: 'staff', actorId: String(session.staffId), note: 'Добавлен комментарий' });
      });
    },

    /** Массово: назначить ответственного или перевести в «закрыто»/«отменена»; чужие и неподходящие id пропускаются и перечисляются. */
    bulk(session: StaffSession | null, ids: unknown, action: { type: 'assign'; staffId: number | null } | { type: 'status'; to: RequestStatus }, opts: Opts = {}): { done: number[]; skipped: number[] } {
      requirePermission(session, writePerm);
      if (!Array.isArray(ids) || ids.length === 0) throw new ValidationError('Отметьте хотя бы одну запись');
      if (ids.length > 200) throw new ValidationError('За раз можно обработать не больше 200 записей');
      const done: number[] = [];
      const skipped: number[] = [];
      for (const raw of ids) {
        const id = Number(raw);
        try {
          if (action.type === 'assign') this.assign(session, id, action.staffId, opts);
          else this.setStatus(session, id, action.to, null, opts);
          done.push(id);
        } catch (e) {
          if (e instanceof NotFoundError || e instanceof ConflictError) skipped.push(id);
          else throw e;
        }
      }
      return { done, skipped };
    },
  };
}

export const inquiriesOps = makeOps('inquiries');
const repairsBase = makeOps('repairs');

export type RepairPatch = { equipmentType?: string; brand?: string; model?: string; message?: string; phone?: string; email?: string };

export const repairsOps = {
  ...repairsBase,
  // `this` в bulk должен указывать на repairsBase, а не на расширенный объект
  bulk: repairsBase.bulk.bind(repairsBase),

  /** Правка полей заявки (бренд, модель, тип, описание, контакты). Аудит без значений контактов. */
  updateFields(session: StaffSession | null, id: number, patch: RepairPatch, opts: Opts = {}): RequestRow {
    requirePermission(session, 'repair.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    return withTransaction(db, () => {
      const r = requestsRepo.findById(db, id);
      if (!r || r.kind !== 'repair') throw new NotFoundError('Заявка не найдена');
      const pick = (v: string | undefined, cur: string | null, label: string, max: number): string | null => {
        if (v === undefined) return cur;
        const t = v.trim();
        if (t.length > max) throw new ValidationError(`${label}: не длиннее ${max} символов`);
        return t === '' ? null : t;
      };
      let phone = r.phone;
      if (patch.phone !== undefined) {
        phone = patch.phone.trim() === '' ? null : normalizePhone(patch.phone);
        if (patch.phone.trim() !== '' && phone === null) throw new ValidationError('Укажите телефон в формате +7 900 000-00-00');
      }
      let email = r.email;
      if (patch.email !== undefined) {
        const e = patch.email.trim().toLowerCase();
        if (e !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new ValidationError('Проверьте адрес электронной почты');
        email = e === '' ? null : e;
      }
      const next = {
        equipmentType: pick(patch.equipmentType, r.equipmentType, 'Тип техники', 100),
        repairBrand: pick(patch.brand, r.repairBrand, 'Бренд', 80),
        repairModel: pick(patch.model, r.repairModel, 'Модель', 80),
        message: pick(patch.message, r.message, 'Описание', 2000),
        phone,
        email,
      };
      requestsRepo.updateRepairFields(db, id, next, now);
      const changed = (Object.keys(next) as Array<keyof typeof next>).filter((k) => next[k] !== ({ equipmentType: r.equipmentType, repairBrand: r.repairBrand, repairModel: r.repairModel, message: r.message, phone: r.phone, email: r.email })[k]);
      if (changed.length > 0) {
        requestsRepo.insertEvent(db, { requestId: id, at: now, kind: 'edit', actorType: 'staff', actorId: String(session.staffId), note: `Изменено: ${changed.join(', ')}` });
        audit.record({ actorId: session.staffId, actorType: 'staff', action: 'repair.edit', entity: 'repair', entityId: id, before: { number: r.number }, after: { changed } }, { db, now });
      }
      return requestsRepo.findById(db, id)!;
    });
  },

  /** Фото (до 5): сигнатура и содержимое проверяются в src/media; файл перекодируется, имя случайное. */
  async addPhoto(session: StaffSession | null, id: number, bytes: Uint8Array, opts: Opts & { uploadsDir?: string } = {}): Promise<RequestPhotoRow> {
    requirePermission(session, 'repair.write');
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const r = requestsRepo.findById(db, id);
    if (!r || r.kind !== 'repair') throw new NotFoundError('Заявка не найдена');
    if (requestsRepo.countPhotos(db, id) >= REPAIR_PHOTO_LIMIT) throw new ConflictError(`К заявке можно приложить не больше ${REPAIR_PHOTO_LIMIT} фото`);
    let stored;
    try {
      stored = await storeImage(bytes, opts.uploadsDir ? { dir: opts.uploadsDir } : {});
    } catch (e) {
      if (e instanceof ImageStoreError) throw new ValidationError(e.message);
      throw e;
    }
    return withTransaction(db, () => {
      if (requestsRepo.countPhotos(db, id) >= REPAIR_PHOTO_LIMIT) throw new ConflictError(`К заявке можно приложить не больше ${REPAIR_PHOTO_LIMIT} фото`);
      const photoId = requestsRepo.insertPhoto(db, { requestId: id, path: stored.path, width: stored.width, height: stored.height, position: requestsRepo.countPhotos(db, id), now });
      requestsRepo.insertEvent(db, { requestId: id, at: now, kind: 'photo', actorType: 'staff', actorId: String(session.staffId), note: 'Добавлено фото' });
      audit.record({ actorId: session.staffId, actorType: 'staff', action: 'repair.photo', entity: 'repair', entityId: id, after: { photoId } }, { db, now });
      return requestsRepo.findPhoto(db, photoId)!;
    });
  },

  /** Файл фото для показа: только если фото принадлежит этой заявке (иначе null → 404). */
  photoFile(session: StaffSession | null, requestId: number, photoId: number, opts: Opts = {}): RequestPhotoRow | null {
    requirePermission(session, 'repair.write');
    const p = requestsRepo.findPhoto(opts.db ?? getDb(), photoId);
    return p && p.requestId === requestId ? p : null;
  },
};
