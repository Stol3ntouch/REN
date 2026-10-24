import { describe, expect, it } from 'vitest';
import { listForStaff, markAllRead, markRead, notify, totalCount, unreadCount } from '@/domain/admin/notifications';
import { createStaff } from '@/domain/admin/staff';
import { createTestDb } from '@/server/db/testing';
import { ValidationError } from '@/server/http/errors';
import { T0 } from '../auth/helpers';

const MIN = 60_000;

async function setup() {
  const db = createTestDb();
  const mk = async (login: string, role: string) => (await createStaff({ email: login, password: `${login}-password-123`, role }, { db, now: T0 })).staffId;
  const manager = await mk('mgr-one', 'manager');
  const manager2 = await mk('mgr-two', 'manager');
  const content = await mk('content-one', 'content_manager');
  return { db, o: { db, now: T0 }, manager, manager2, content };
}

describe('уведомления: хранилище', () => {
  it('audience: по праву видят только те, у кого оно есть; all — все; чужое markRead не открывает', async () => {
    const { db, o, manager, content } = await setup();
    const orderN = notify({ type: 'order.created', title: 'Новый заказ RTS-1', href: '/admin/orders/RTS-1', entity: 'order', entityId: 'RTS-1', audience: 'permission:orders.read' }, o);
    const allN = notify({ type: 'system.info', title: 'Для всех' }, o);
    expect(listForStaff(manager, {}, o).map((n) => n.id).sort()).toEqual([orderN.id, allN.id].sort());
    expect(listForStaff(content, {}, o).map((n) => n.id)).toEqual([allN.id]);
    expect(markRead(content, orderN.id, o)).toBe(false);
    expect(unreadCount(content, o)).toBe(1);
    expect(markRead(manager, 99999, o)).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM admin_notification_reads').get()).toEqual({ n: 0 });
  });

  it('прочтение у каждого сотрудника своё; unreadOnly, лимит, markAllRead', async () => {
    const { o, manager, manager2 } = await setup();
    const a = notify({ type: 't.a', title: 'A' }, { ...o, now: T0 });
    const b = notify({ type: 't.b', title: 'B' }, { ...o, now: T0 + MIN });
    notify({ type: 't.c', title: 'C' }, { ...o, now: T0 + 2 * MIN });
    expect(markRead(manager, a.id, o)).toBe(true);
    expect(unreadCount(manager, o)).toBe(2);
    expect(unreadCount(manager2, o)).toBe(3);
    expect(listForStaff(manager, { unreadOnly: true }, o).map((n) => n.title)).toEqual(['C', 'B']);
    expect(listForStaff(manager2, { limit: 2 }, o).map((n) => n.title)).toEqual(['C', 'B']);
    expect(listForStaff(manager, {}, o).find((n) => n.id === a.id)!.read).toBe(true);
    expect(listForStaff(manager2, {}, o).find((n) => n.id === a.id)!.read).toBe(false);
    expect(markAllRead(manager, o)).toBe(2);
    expect(unreadCount(manager, o)).toBe(0);
    expect(unreadCount(manager2, o)).toBe(3);
    expect(totalCount(manager, o)).toBe(3);
    void b;
  });

  it('дедупликация по type + entity + entityId в окне; после окна и без entityId — новое', async () => {
    const { db, o } = await setup();
    const first = notify({ type: 'import.failed', title: 'Импорт упал', entity: 'import', entityId: 7 }, o);
    const again = notify({ type: 'import.failed', title: 'Импорт упал', entity: 'import', entityId: '7' }, { ...o, now: T0 + MIN });
    expect(again).toEqual({ id: first.id, deduplicated: true });
    expect(notify({ type: 'import.failed', title: 'Другой объект', entity: 'import', entityId: 8 }, o).deduplicated).toBe(false);
    const later = notify({ type: 'import.failed', title: 'Импорт упал', entity: 'import', entityId: 7 }, { ...o, now: T0 + 16 * MIN });
    expect(later.deduplicated).toBe(false);
    expect(notify({ type: 'x.y', title: 'Без объекта' }, o).deduplicated).toBe(false);
    expect(notify({ type: 'x.y', title: 'Без объекта' }, o).deduplicated).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM admin_notifications').get()).toEqual({ n: 5 });
  });

  it('безопасность: внешняя ссылка и неизвестный адресат отвергаются, email в тексте маскируется; заблокированный ничего не видит', async () => {
    const { db, o, manager } = await setup();
    for (const href of ['https://evil.example/x', '//evil.example', 'javascript:alert(1)', '/admin/../etc', '/administrator']) {
      expect(() => notify({ type: 'a.b', title: 'T', href }, o)).toThrow(ValidationError);
    }
    expect(() => notify({ type: 'a.b', title: 'T', audience: 'permission:nope.nope' }, o)).toThrow(ValidationError);
    expect(() => notify({ type: 'BAD TYPE', title: 'T' }, o)).toThrow(ValidationError);
    const n = notify({ type: 'request.created', title: 'Заявка', body: 'Пишет ivan.petrov@mail.test, +7 912 345-67-89' }, o);
    const row = db.prepare('SELECT body FROM admin_notifications WHERE id = ?').get(n.id) as { body: string };
    expect(row.body).not.toMatch(/ivan\.petrov|345-67-89/);
    db.prepare('UPDATE staff SET active = 0 WHERE id = ?').run(manager);
    expect(listForStaff(manager, {}, o)).toEqual([]);
    expect(unreadCount(manager, o)).toBe(0);
    expect(markAllRead(manager, o)).toBe(0);
  });
});
