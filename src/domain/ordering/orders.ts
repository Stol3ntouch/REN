import { enqueueMail } from '@/domain/admin/mail-enqueue';
import { audit } from '@/domain/admin/audit';
import { stock } from '@/domain/catalog/stock';
import { hasPermission } from '@/domain/admin/permissions';
import { getConfig } from '@/server/config';
import { getDb, withTransaction, type Db } from '@/server/db/connection';
import { promosRepo } from '@/server/db/repositories/promos';
import { ordersRepo, type OrderRow } from '@/server/db/repositories/orders';
import { staffRepo } from '@/server/db/repositories/staff';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/server/http/errors';
import type { OwnerRef } from '@/server/http/owner';
import { addInternalComment } from './order-edit';
import { orderAccessPath, verifyOrderAccessToken } from './access-token';
import { getPaymentRefunder } from './payment-flow';
import { PRIVILEGED_REVERT_FROM, REVERSE_TRANSITIONS, STATUS_LABELS, TRANSITIONS } from './status';
import { actorEventType, type Actor, type Opts, type Order, type OrderEvent, type OrderStatus } from './types';

const NOTE_MAX = 500;

import { toOrder } from './order-view';

export { toOrder };

function sameOwner(row: OrderRow, owner: OwnerRef): boolean {
  return owner.kind === 'user' ? row.userId === owner.userId : row.guestId !== null && row.guestId === owner.guestId;
}

/** Ссылка на заказ для письма: абсолютная при заданном SITE_URL; гостю — с токеном. */
export function orderUrlFor(order: Pick<Order, 'number' | 'owner'>, opts: Opts = {}): string {
  const path = order.owner.kind === 'guest' ? orderAccessPath(order.number, opts.secret) : `/order/${encodeURIComponent(order.number)}`;
  let base = '';
  try {
    base = getConfig().siteUrl ?? '';
  } catch {
    base = '';
  }
  return `${base}${path}`;
}

const auditActor = (a: Actor): { actorId: string | number | null; actorType: 'staff' | 'user' | 'system' } => {
  if (a.type === 'staff') return { actorId: a.staffId, actorType: 'staff' };
  if (a.type === 'customer') return { actorId: a.owner.kind === 'user' ? a.owner.userId : null, actorType: 'user' };
  return { actorId: null, actorType: 'system' };
};

const eventActorId = (a: Actor): string | null => {
  if (a.type === 'staff') return String(a.staffId);
  if (a.type === 'customer') return a.owner.kind === 'user' ? String(a.owner.userId) : null;
  return a.reason ?? null;
};

function cleanNote(note: string | undefined): string | null {
  const t = (note ?? '').trim();
  if (t.length > NOTE_MAX) throw new ValidationError(`Заметка не длиннее ${NOTE_MAX} символов`);
  return t === '' ? null : t;
}

/** Права по роли, которые не выражены таблицей переходов. Бросает ForbiddenError. */
function assertActorMayMove(actor: Actor, to: OrderStatus, viaRefund = false, revert = false): void {
  if (actor.type === 'staff' && !hasPermission(actor, 'orders.write')) {
    throw new ForbiddenError('Недостаточно прав для смены статуса заказа');
  }
  // R41.1: «оплачен» / «ошибка оплаты» — только по проверенному webhook (система), не руками и не возвратом браузера.
  if ((to === 'paid' || to === 'payment_failed') && actor.type !== 'system' && !revert) {
    throw new ForbiddenError('Статус оплаты ставится только по подтверждению платёжной системы');
  }
  // Возврат средств — право orders.refund (администратор) или система.
  if (!revert && to === 'refunded' && !(actor.type === 'system' || (actor.type === 'staff' && hasPermission(actor, 'orders.refund')))) {
    throw new ForbiddenError('Возврат средств доступен только администратору');
  }
  // Сотрудник ставит «возвращён» только через orders.refund (после успешного возврата платежа), не обычной сменой статуса.
  if (!revert && to === 'refunded' && actor.type === 'staff' && !viaRefund) {
    throw new ForbiddenError('Возврат оформляется действием «Вернуть деньги», а не сменой статуса');
  }
  if (actor.type === 'customer') throw new ForbiddenError('Покупатель не может менять статус заказа');
}

/**
 * Отмена, а также возврат денег до исполнения (заказ ещё не отгружен) освобождают использование промокода.
 * Остальные переходы промокод не трогают.
 */
function releasesPromo(from: OrderStatus, to: OrderStatus): boolean {
  return to === 'cancelled' || (to === 'refunded' && from !== 'shipped' && from !== 'delivered');
}

/** Возвращает использование промокода заказа один раз (признак promo_released). true — вернули сейчас. */
function releasePromo(db: Db, orderId: number): boolean {
  const promoId = ordersRepo.markPromoReleased(db, orderId);
  if (promoId === null) return false;
  promosRepo.release(db, promoId);
  return true;
}

export const orders = {
  /**
   * Единственная точка смены статуса. Проверяет актора, таблицу переходов и правила оплаты,
   * в одной транзакции обновляет заказ, пишет order_event и аудит; после коммита ставит письмо order.status_changed.
   * Недопустимый переход → ConflictError (409); чужие права → ForbiddenError; нет заказа → NotFoundError.
   */
  async transition(orderId: number, to: OrderStatus, actor: Actor, note?: string, opts: Opts = {}): Promise<Order> {
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    const text = cleanNote(note);
    const revert = opts.revert === true;

    const result = withTransaction(db, () => {
      const row = ordersRepo.findById(db, orderId);
      if (!row) throw new NotFoundError('Заказ не найден');
      assertActorMayMove(actor, to, opts.viaRefund === true, revert);
      if (revert) {
        // Возврат на шаг — только по явной таблице, с причиной; «Выполнен»/«Отменён» возвращает лишь orders.refund.
        if (!text) throw new ValidationError('Укажите причину возврата на предыдущий шаг');
        if (!REVERSE_TRANSITIONS[row.status].includes(to)) {
          throw new ConflictError(`Нельзя вернуть заказ из статуса «${STATUS_LABELS[row.status]}» в «${STATUS_LABELS[to]}»`);
        }
        if (PRIVILEGED_REVERT_FROM.includes(row.status) && !(actor.type === 'system' || (actor.type === 'staff' && hasPermission(actor, 'orders.refund')))) {
          throw new ForbiddenError(`Из статуса «${STATUS_LABELS[row.status]}» заказ возвращает только администратор`);
        }
      } else if (!TRANSITIONS[row.status].includes(to)) {
        throw new ConflictError(`Нельзя перевести заказ из статуса «${STATUS_LABELS[row.status]}» в «${STATUS_LABELS[to]}»`);
      }
      if (to === 'cancelled' && row.isPaid) {
        throw new ConflictError('Оплаченный заказ нельзя отменить: оформите возврат средств');
      }
      if (to === 'refunded' && !row.isPaid) {
        throw new ConflictError('Возврат возможен только для оплаченного заказа');
      }
      const paidFlag = to === 'paid' ? true : to === 'refunded' ? false : undefined;
      ordersRepo.setStatus(db, row.id, to, now, paidFlag);
      stock.onOrderStatus(row.id, to, { db, now }); // C04: списание / возврат резерва
      let promoReleased = revert ? false : releasesPromo(row.status, to) ? releasePromo(db, row.id) : false;
      if (revert && row.status === 'cancelled' && row.promoId !== null && row.promoReleased) {
        // Отмена была ошибкой: заказ снова занимает использование промокода.
        if (!promosRepo.tryConsume(db, row.promoId)) throw new ConflictError('Нельзя вернуть заказ: лимит использований промокода исчерпан');
        ordersRepo.clearPromoReleased(db, row.id);
        promoReleased = false;
      }
      ordersRepo.insertEvent(db, {
        orderId: row.id,
        at: now,
        kind: revert ? 'revert' : 'status',
        fromStatus: row.status,
        toStatus: to,
        actorType: actorEventType(actor),
        actorId: eventActorId(actor),
        note: text,
      });
      audit.record(
        {
          ...auditActor(actor),
          action: revert ? 'order.revert' : 'order.status',
          entity: 'order',
          entityId: row.id,
          before: { status: row.status },
          after: { status: to, note: text ?? undefined, promoReleased: promoReleased || undefined },
        },
        { db, now },
      );
      return { from: row.status, order: toOrder(db, ordersRepo.findById(db, row.id)!) };
    });

    enqueueMail(
      'order.status_changed',
      {
        to: result.order.contact.email,
        name: result.order.contact.name,
        orderNumber: result.order.number,
        fromStatus: result.from,
        toStatus: to,
        statusLabel: STATUS_LABELS[to],
        orderUrl: orderUrlFor(result.order, opts),
      },
      { db, now },
    );
    return result.order;
  },

  /** Возврат средств (только админ/система): PaymentPort.refund через зарегистрированный возвратчик, затем статус «refunded». */
  async refund(orderId: number, actor: Actor, note?: string, opts: Opts = {}): Promise<Order> {
    const db = opts.db ?? getDb();
    const row = ordersRepo.findById(db, orderId);
    if (!row) throw new NotFoundError('Заказ не найден');
    assertActorMayMove(actor, 'refunded', true);
    if (!row.isPaid) throw new ConflictError('Возврат возможен только для оплаченного заказа');
    const refunder = opts.refunder ?? getPaymentRefunder();
    if (!refunder) throw new ConflictError('Возврат через платёжную систему пока недоступен: оплата не подключена');
    // Ключ идемпотентности: возвратчик резервирует платёж до внешнего вызова, второй параллельный клик получает 409.
    await refunder(toOrder(db, row), { idempotencyKey: `refund:${row.id}` });
    return orders.transition(orderId, 'refunded', actor, note, { ...opts, viaRefund: true });
  },

  /** Заказ покупателя; чужой или несуществующий → null (страница отвечает 404). ref — номер RTS-… или id. */
  getForCustomer(ref: string | number, owner: OwnerRef | null, opts: Opts = {}): Order | null {
    if (!owner) return null;
    const db = opts.db ?? getDb();
    const row = typeof ref === 'number' ? ordersRepo.findById(db, ref) : ordersRepo.findByNumber(db, String(ref).trim().toUpperCase());
    if (!row || !sameOwner(row, owner)) return null;
    return toOrder(db, row);
  },

  /** Гостевая ссылка: номер + подписанный токен. Любая ошибка (нет заказа, чужой токен) → null, без различий. */
  getByGuestToken(number: string, token: string | null | undefined, opts: Opts = {}): Order | null {
    const normalized = String(number).trim().toUpperCase();
    if (!verifyOrderAccessToken(normalized, token, opts.secret)) return null;
    const db = opts.db ?? getDb();
    const row = ordersRepo.findByNumber(db, normalized);
    return row ? toOrder(db, row) : null;
  },

  /** Заказ для сотрудника (права проверяет вызывающий обработчик). */
  getForStaff(number: string, opts: Opts = {}): Order | null {
    const db = opts.db ?? getDb();
    const row = ordersRepo.findByNumber(db, String(number).trim().toUpperCase());
    return row ? toOrder(db, row) : null;
  },

  listForOwner(owner: OwnerRef | null, opts: Opts = {}): Order[] {
    if (!owner) return [];
    const db = opts.db ?? getDb();
    return ordersRepo.listForOwner(db, owner).map((r) => toOrder(db, r));
  },

  /** История статусов (для покупателя — без служебных заметок сотрудников). */
  events(orderId: number, opts: Opts & { forCustomer?: boolean } = {}): OrderEvent[] {
    const db = opts.db ?? getDb();
    return ordersRepo
      .listEvents(db, orderId)
      .filter((e) => !opts.forCustomer || e.kind === 'created' || e.kind === 'status')
      .map((e) => ({
        id: e.id,
        at: e.at,
        kind: e.kind,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actorType: e.actorType,
        actorId: e.actorId,
        // Покупателю заметки сотрудников не показываем
        note: opts.forCustomer ? null : e.note,
      }));
  },

  /** Назначить ответственного менеджера (или снять: staffId null). Событие + аудит. */
  assign(orderId: number, staffId: number | null, actor: Actor, opts: Opts = {}): Order {
    const db = opts.db ?? getDb();
    const now = opts.now ?? Date.now();
    if (actor.type !== 'staff' || !hasPermission(actor, 'orders.write')) throw new ForbiddenError('Недостаточно прав');
    return withTransaction(db, () => {
      const row = ordersRepo.findById(db, orderId);
      if (!row) throw new NotFoundError('Заказ не найден');
      if (staffId !== null) {
        const s = staffRepo.findById(db, staffId);
        if (!s || !s.active) throw new ValidationError('Сотрудник не найден или отключён');
      }
      ordersRepo.setAssigned(db, row.id, staffId, now);
      ordersRepo.insertEvent(db, {
        orderId: row.id,
        at: now,
        kind: 'assigned',
        actorType: 'staff',
        actorId: String(actor.staffId),
        note: staffId === null ? 'Ответственный снят' : `Ответственный: сотрудник №${staffId}`,
      });
      audit.record(
        {
          actorId: actor.staffId,
          actorType: 'staff',
          action: 'order.assign',
          entity: 'order',
          entityId: row.id,
          before: { assignedStaffId: row.assignedStaffId },
          after: { assignedStaffId: staffId },
        },
        { db, now },
      );
      return toOrder(db, ordersRepo.findById(db, row.id)!);
    });
  },

  /** Внутренний комментарий сотрудника: отдельная запись order_comments (автор, время) и след в истории. */
  addNote(orderId: number, text: string, actor: Actor, opts: Opts = {}): void {
    addInternalComment(orderId, text, actor, opts);
  },
};
