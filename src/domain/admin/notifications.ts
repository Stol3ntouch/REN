import { z } from 'zod';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { notificationsRepo, type NotificationForStaff, type NotificationSeverity } from '@/server/db/repositories/notifications';
import { staffRepo } from '@/server/db/repositories/staff';
import { ValidationError } from '@/server/http/errors';
import { isPermission } from './permission-catalog';
import { maskPii } from './mask';
import { loadRolePermissions } from './role-permissions';

export type { NotificationForStaff, NotificationSeverity };

type Opts = { db?: Db; now?: number };

/** Окно дедупликации по умолчанию: то же событие по тому же объекту не создаёт второго уведомления. */
export const NOTIFY_DEDUP_WINDOW_MS = 15 * 60 * 1000;
export const NOTIFICATIONS_MAX_LIMIT = 100;

/** Кому показывается: всем сотрудникам или тем, у кого есть право (`permission:orders.read`). */
export type NotifyAudience = 'all' | `permission:${string}`;

export type NotifyInput = {
  /** Машинный тип: order.created, request.created, import.failed … */
  type: string;
  title: string;
  body?: string | null;
  /** Внутренняя ссылка на объект: /admin/orders/RTS-… */
  href?: string | null;
  entity?: string | null;
  entityId?: string | number | null;
  severity?: NotificationSeverity;
  audience?: NotifyAudience;
};

const inputSchema = z.object({
  type: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/, 'Тип уведомления: латиница, цифры, . _ -'),
  title: z.string().trim().min(1, 'Укажите заголовок').max(200),
  body: z.string().trim().max(1000).nullish(),
  href: z.string().max(500).nullish(),
  entity: z.string().max(64).nullish(),
  entityId: z.union([z.string().max(100), z.number()]).nullish(),
  severity: z.enum(['info', 'success', 'warning', 'error']).default('info'),
  audience: z.string().default('all'),
});

/** Ссылка только внутри админки: без схемы, без «//» и обратных слэшей (никакого открытого редиректа). */
function cleanHref(href: string | null | undefined): string | null {
  if (!href) return null;
  if (!/^\/admin(\/[^\s\\]*)?$/.test(href) || href.includes('//') || href.includes('..')) {
    throw new ValidationError('Ссылка уведомления должна вести внутрь админки', { href: ['Недопустимая ссылка'] });
  }
  return href;
}

function cleanAudience(audience: string): string {
  if (audience === 'all') return audience;
  const m = /^permission:(.+)$/.exec(audience);
  if (!m || !isPermission(m[1])) throw new ValidationError('Адресат уведомления указан неверно', { audience: ['Неизвестный адресат'] });
  return audience;
}

/** Права сотрудника из БД. Неизвестный или отключённый сотрудник → пусто (уведомлений не видит). */
function permissionsOfStaff(db: Db, staffId: number): string[] {
  const s = Number.isInteger(staffId) ? staffRepo.findById(db, staffId) : null;
  return s && s.active ? loadRolePermissions(db, s.roleId, s.role) : [];
}

/**
 * Создаёт административное уведомление. Если за окно (dedupWindowMs) уже есть уведомление с тем же
 * type + entity + entityId, новое не создаётся и возвращается id прежнего. Без entityId дедупликации нет.
 * Email и телефоны в тексте маскируются.
 */
export function notify(input: NotifyInput, opts: Opts & { dedupWindowMs?: number } = {}): { id: number; deduplicated: boolean } {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Уведомление заполнено неверно');
  const v = parsed.data;
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const href = cleanHref(v.href);
  const audience = cleanAudience(v.audience);
  const entityId = v.entityId === undefined || v.entityId === null ? null : String(v.entityId);

  return withTransaction(db, () => {
    if (entityId !== null) {
      const dup = notificationsRepo.findRecent(db, { type: v.type, entity: v.entity ?? null, entityId, since: now - (opts.dedupWindowMs ?? NOTIFY_DEDUP_WINDOW_MS) });
      if (dup !== null) return { id: dup, deduplicated: true };
    }
    const id = notificationsRepo.insert(db, {
      type: v.type,
      title: maskPii(v.title),
      body: v.body ? maskPii(v.body) : null,
      entity: v.entity ?? null,
      entityId,
      href,
      severity: v.severity,
      audience,
      now,
    });
    return { id, deduplicated: false };
  });
}

/** Уведомления сотрудника: только адресованные ему (по audience), новые сверху; read — прочитано ли именно им. */
export function listForStaff(staffId: number, f: { unreadOnly?: boolean; limit?: number; offset?: number } = {}, opts: Opts = {}): NotificationForStaff[] {
  const db = opts.db ?? getDb();
  const perms = permissionsOfStaff(db, staffId);
  if (perms.length === 0) return [];
  return notificationsRepo.listForStaff(db, staffId, perms, {
    unreadOnly: f.unreadOnly ?? false,
    limit: Math.min(Math.max(f.limit ?? 20, 1), NOTIFICATIONS_MAX_LIMIT),
    offset: Math.max(f.offset ?? 0, 0),
  });
}

export function unreadCount(staffId: number, opts: Opts = {}): number {
  const db = opts.db ?? getDb();
  const perms = permissionsOfStaff(db, staffId);
  return perms.length === 0 ? 0 : notificationsRepo.countForStaff(db, staffId, perms, true);
}

export function totalCount(staffId: number, opts: Opts = {}): number {
  const db = opts.db ?? getDb();
  const perms = permissionsOfStaff(db, staffId);
  return perms.length === 0 ? 0 : notificationsRepo.countForStaff(db, staffId, perms, false);
}

/** Отмечает уведомление прочитанным у этого сотрудника. Чужое (недоступное по audience) или несуществующее → false. */
export function markRead(staffId: number, notificationId: number, opts: Opts = {}): boolean {
  const db = opts.db ?? getDb();
  const perms = permissionsOfStaff(db, staffId);
  if (perms.length === 0 || !Number.isInteger(notificationId) || !notificationsRepo.isVisible(db, notificationId, perms)) return false;
  notificationsRepo.markRead(db, notificationId, staffId, opts.now ?? Date.now());
  return true;
}

/** Отмечает прочитанными все доступные сотруднику уведомления; возвращает, сколько стало прочитанным. */
export function markAllRead(staffId: number, opts: Opts = {}): number {
  const db = opts.db ?? getDb();
  const perms = permissionsOfStaff(db, staffId);
  if (perms.length === 0) return 0;
  const before = notificationsRepo.countForStaff(db, staffId, perms, true);
  notificationsRepo.markAllRead(db, staffId, perms, opts.now ?? Date.now());
  return before;
}
