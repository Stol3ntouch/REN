import { createStaff } from '@/domain/admin/staff';
import { createStaffSession, ADMIN_SESSION_COOKIE } from '@/domain/admin/staff-session';
import { rolesService } from '@/domain/admin/roles';
import { SYSTEM_ROLES } from '@/domain/admin/permission-catalog';
import type { Permission } from '@/domain/admin/permissions';
import type { Db } from '@/server/db/connection';
import { createTestDb } from '@/server/db/testing';
import { fakeCookies, T0 } from '../auth/helpers';

export { T0, ADMIN_SESSION_COOKIE };

const g = globalThis as unknown as { __rtsDb?: Db };

export type Harness = {
  db: Db;
  /** Токены cookie сессии по коду роли (системные роли + `none` — своя роль без единого права, `limited` — только orders.read). */
  tokens: Record<string, string>;
  staffIds: Record<string, number>;
  /** Подключает БД теста как соединение приложения (route handlers берут getDb()). */
  attach(): void;
  detach(): void;
  /** Запрос к обработчику от имени роли (token = код роли) или без входа. */
  request(url: string, o?: { role?: string; method?: string; origin?: string | null; body?: BodyInit; headers?: Record<string, string> }): Request;
};

/** Изолированная БД с сотрудниками всех системных ролей и двумя своими ролями. Сеть и реальные данные не затрагиваются. */
export async function makeHarness(): Promise<Harness> {
  const db = createTestDb();
  const tokens: Record<string, string> = {};
  const staffIds: Record<string, number> = {};
  const roleOf: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) roleOf[r.code] = r.code;
  const boss = await createStaff({ email: 'root', password: 'root-password-1', role: 'super_admin' }, { db, now: T0 });
  staffIds.super_admin = boss.staffId;
  const bossSession = { staffId: boss.staffId, email: 'root', name: null, role: 'super_admin' };
  const none = rolesService.create(bossSession, { name: 'Без прав', permissions: [] }, { db, now: T0 });
  const limited = rolesService.create(bossSession, { name: 'Только заказы', permissions: ['orders.read'] satisfies Permission[] }, { db, now: T0 });
  roleOf.none = none.code;
  roleOf.limited = limited.code;
  for (const [key, code] of Object.entries(roleOf)) {
    if (key !== 'super_admin') staffIds[key] = (await createStaff({ email: `user-${key}`, password: `password-${key}-1`, role: code }, { db, now: T0 })).staffId;
  }
  for (const [key, id] of Object.entries(staffIds)) {
    const jar = fakeCookies();
    createStaffSession(jar, id, { db, now: Date.now() });
    tokens[key] = jar.jar.get(ADMIN_SESSION_COOKIE)!;
  }
  return {
    db,
    tokens,
    staffIds,
    attach: () => {
      g.__rtsDb = db;
    },
    detach: () => {
      delete g.__rtsDb;
    },
    request(url, o = {}) {
      const method = o.method ?? 'GET';
      const headers = new Headers({ host: 'shop.test', ...(o.headers ?? {}) });
      if (method !== 'GET' && o.origin !== null) headers.set('origin', o.origin ?? 'http://shop.test');
      if (o.role) headers.set('cookie', `${ADMIN_SESSION_COOKIE}=${tokens[o.role]}`);
      return new Request(url, { method, headers, ...(o.body !== undefined ? { body: o.body } : {}) });
    },
  };
}

// ───────────── магазин и заказ гостя (через домен, как на сайте) ─────────────
import { cart } from '@/domain/ordering/cart';
import { checkout } from '@/domain/ordering/checkout';
import type { OwnerRef } from '@/server/http/owner';
import { addCategory, addProduct } from '../catalog/helpers';
import { deliveryId, paymentId } from '../ordering/helpers';

export const SHOP_SECRET = 'test-secret-test-secret-test-secret-123456';

export function seedShop(db: Db, o: { name?: string; slug?: string; sku?: string; priceKopecks?: number } = {}): { categoryId: number; productId: number } {
  const categoryId = addCategory(db, 'Триммеры', `trimmery-${Math.random().toString(36).slice(2, 7)}`);
  const productId = addProduct(db, { name: o.name ?? 'Триммер CHAMPION T523', sku: o.sku ?? 'T523', slug: o.slug ?? `champion-t523-${Math.random().toString(36).slice(2, 7)}`, categoryId });
  db.prepare('UPDATE products SET price_kopecks = ?, in_stock = 1 WHERE id = ?').run(o.priceKopecks ?? 450_000, productId);
  return { categoryId, productId };
}

let guestSeq = 0;
/** Заказ гостя: товар → корзина → оформление. Возвращает номер, id и токен-владельца гостя. */
export async function placeGuestOrder(db: Db, productId: number, o: { name?: string; payment?: string } = {}) {
  guestSeq += 1;
  const guest: OwnerRef = { kind: 'guest', guestId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(guestSeq).padStart(12, '0')}` };
  cart.add(guest, { productId, qty: 1 }, { db, now: T0 });
  const c = cart.get(guest, { db });
  const order = await checkout.place(
    {
      owner: guest,
      cartId: c.cartId,
      contact: { name: o.name ?? 'Иван Иванов', email: 'ivan@example.test', phone: '+7 900 111-22-33' },
      deliveryMethodId: deliveryId(db, 'pickup'),
      paymentMethodId: paymentId(db, o.payment ?? 'cod'),
      idempotencyKey: `idem-key-${String(guestSeq).padStart(12, '0')}`,
      consent: true,
    },
    { db, now: T0, secret: SHOP_SECRET },
  );
  return { order, guest };
}
