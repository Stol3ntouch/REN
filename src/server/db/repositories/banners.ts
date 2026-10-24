import type { Db } from '../connection';
import { makeContentRepo } from './content-base';

export const BANNER_POSITIONS = ['home_hero', 'category', 'top_strip', 'home_middle'] as const;
export type BannerPosition = (typeof BANNER_POSITIONS)[number];
export type BannerStatus = 'active' | 'inactive';

export type BannerRow = {
  id: number;
  title: string;
  imagePath: string | null;
  imageVariants: string | null;
  mobileImagePath: string | null;
  mobileImageVariants: string | null;
  alt: string | null;
  heading: string | null;
  subheading: string | null;
  buttonText: string | null;
  url: string | null;
  position: BannerPosition;
  startsAt: number | null;
  endsAt: number | null;
  sort: number;
  status: BannerStatus;
  createdAt: number;
  updatedAt: number;
};
export type BannerWrite = Partial<Omit<BannerRow, 'id' | 'updatedAt'>>;

/** Максимум активных баннеров в позиции главной «hero» (как было у слайдера). */
export const MAX_HERO_BANNERS = 3;

const base = makeContentRepo<BannerRow, BannerWrite>({
  table: 'banners',
  columns: [
    'title', 'imagePath', 'imageVariants', 'mobileImagePath', 'mobileImageVariants', 'alt', 'heading', 'subheading', 'buttonText', 'url',
    'position', 'startsAt', 'endsAt', 'sort', 'status', 'createdAt',
  ],
  order: 'sort, id',
});

/** Баннер действует в момент now: статус active и внутри периода (границы необязательны). */
export const BANNER_LIVE_SQL = "(status = 'active' AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?))";

export type BannerCategoryLink = { bannerId: number; categoryId: number; sort: number; enabled: boolean };
export type BannerCategoryRow = BannerCategoryLink & { categoryName: string };

export const bannersRepo = {
  ...base,
  /** Действующие на now баннеры позиции в порядке показа. */
  listLive(db: Db, position: BannerPosition, now: number): BannerRow[] {
    return base.list(db, `position = ? AND ${BANNER_LIVE_SQL}`, [position, now, now]);
  },
  /** Сколько баннеров позиции со статусом active (кроме одного, если он сейчас правится). */
  countActive(db: Db, position: BannerPosition, exceptId?: number): number {
    return base.count(db, "position = ? AND status = 'active' AND id <> ?", [position, exceptId ?? -1]);
  },
  /** Привязки баннера к категориям (с названиями). */
  listCategories(db: Db, bannerId: number): BannerCategoryRow[] {
    const rows = db
      .prepare(
        `SELECT bc.banner_id, bc.category_id, bc.sort, bc.enabled, c.name FROM banner_categories bc
         JOIN categories c ON c.id = bc.category_id WHERE bc.banner_id = ? ORDER BY bc.sort, c.name`,
      )
      .all(bannerId) as { banner_id: number; category_id: number; sort: number; enabled: number; name: string }[];
    return rows.map((r) => ({ bannerId: r.banner_id, categoryId: r.category_id, sort: r.sort, enabled: r.enabled === 1, categoryName: r.name }));
  },
  /** Заменяет привязки баннера целиком. */
  replaceCategories(db: Db, bannerId: number, links: { categoryId: number; sort: number; enabled: boolean }[]): void {
    db.prepare('DELETE FROM banner_categories WHERE banner_id = ?').run(bannerId);
    const ins = db.prepare('INSERT INTO banner_categories (banner_id, category_id, sort, enabled) VALUES (?, ?, ?, ?)');
    for (const l of links) ins.run(bannerId, l.categoryId, l.sort, l.enabled ? 1 : 0);
  },
  /** Действующие баннеры категории, привязанные именно к ней (не к предкам). */
  listLiveForCategory(db: Db, categoryId: number, now: number): BannerRow[] {
    const ids = db
      .prepare(
        `SELECT b.id FROM banners b JOIN banner_categories bc ON bc.banner_id = b.id
         WHERE bc.category_id = ? AND bc.enabled = 1 AND b.position = 'category' AND ${BANNER_LIVE_SQL.replace(/\b(status|starts_at|ends_at)\b/g, 'b.$1')}
         ORDER BY bc.sort, b.sort, b.id`,
      )
      .all(categoryId, now, now) as { id: number }[];
    return ids.map((r) => base.get(db, r.id) as BannerRow);
  },
  existingCategoryIds(db: Db, ids: number[]): Set<number> {
    if (ids.length === 0) return new Set();
    const rows = db.prepare(`SELECT id FROM categories WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { id: number }[];
    return new Set(rows.map((r) => r.id));
  },
  /** Родитель категории (для наследования баннера вверх по дереву). */
  parentOf(db: Db, categoryId: number): number | null {
    const r = db.prepare('SELECT parent_id FROM categories WHERE id = ?').get(categoryId) as { parent_id: number | null } | undefined;
    return r?.parent_id ?? null;
  },
};
