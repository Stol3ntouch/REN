import type { Db } from '@/server/db/connection';
import { promotionsRepo, type PromotionRow, type PromotionTargets } from '@/server/db/repositories/promotions';

/**
 * Цены по акциям (C08). Всё считается на сервере в целых копейках.
 *
 * Правила:
 *  - акция меняет цену, только если тип скидки percent или fixed, она опубликована и сейчас внутри периода;
 *  - на товар действует НЕ БОЛЕЕ ОДНОЙ акции — с наибольшим приоритетом (при равенстве — большая скидка, затем меньший id);
 *  - скидка считается от обычной цены, не суммируется с собственной скидочной ценой товара: берётся более низкая цена;
 *  - скидка не превышает верхнюю границу акции (maxDiscount), не делает цену ≤ 0 (остаётся минимум 1 копейка) и не больше цены;
 *  - акция с «минимальной суммой» действует, только когда сумма корзины до акций не меньше этой суммы.
 */
export type DiscountRule = { discountType: 'percent' | 'fixed' | 'none'; discountValue: number; maxDiscountKopecks: number | null };

/** Скидка на единицу товара по обычной цене, копейки: 0 ≤ скидка ≤ цена − 1. Процент округляется вниз. */
export function promotionDiscount(listPrice: number, rule: DiscountRule): number {
  if (!Number.isInteger(listPrice) || listPrice <= 1) return 0;
  let discount = 0;
  if (rule.discountType === 'percent') discount = Math.floor((listPrice * rule.discountValue) / 100);
  else if (rule.discountType === 'fixed') discount = rule.discountValue;
  if (rule.maxDiscountKopecks !== null) discount = Math.min(discount, rule.maxDiscountKopecks);
  return Math.max(0, Math.min(discount, listPrice - 1));
}

/** Цена за единицу по акции или null, если акция цену не меняет. */
export function promotionPrice(listPrice: number, rule: DiscountRule): number | null {
  const d = promotionDiscount(listPrice, rule);
  return d > 0 ? listPrice - d : null;
}

export type Period = { startsAt: number | null; endsAt: number | null };

export const periodsOverlap = (a: Period, b: Period): boolean =>
  (a.endsAt === null || b.startsAt === null || a.endsAt >= b.startsAt) && (b.endsAt === null || a.startsAt === null || b.endsAt >= a.startsAt);

// ---------- проверка совместимости при сохранении акции ----------

export type CompatCandidate = Period & { id: number | null; discountType: 'percent' | 'fixed' | 'none'; priority: number; targets: PromotionTargets };

/**
 * Находит конфликт: другая опубликованная акция со скидкой, пересекающаяся по датам и по товарам, с ТЕМ ЖЕ приоритетом —
 * непонятно, какая из них действует. Возвращает описание конфликта или null. Разный приоритет — совместимо (побеждает больший).
 */
export function findPromotionConflict(db: Db, candidate: CompatCandidate): { promotionTitle: string; productName: string } | null {
  if (candidate.discountType === 'none') return null;
  const mine = promotionsRepo.expandProductIds(db, candidate.targets);
  if (mine.size === 0) return null;
  for (const other of promotionsRepo.list(db, "published = 1 AND discount_type <> 'none' AND priority = ?", [candidate.priority])) {
    if (candidate.id !== null && other.id === candidate.id) continue;
    if (!periodsOverlap(candidate, other)) continue;
    const theirs = promotionsRepo.expandProductIds(db, promotionsRepo.targets(db, other.id));
    for (const productId of mine) {
      if (theirs.has(productId)) {
        const name = promotionsRepo.productsByIds(db, [productId])[0]?.name ?? `№${productId}`;
        return { promotionTitle: other.title, productName: name };
      }
    }
  }
  return null;
}

// ---------- цены строк корзины ----------

export type PromotionLine = { productId: number; listKopecks: number; ownKopecks: number; qty: number };
export type PromotionLinePrice = { unit: number; original: number | null; promotionId: number | null };

type Loaded = { row: PromotionRow; products: Set<number>; categories: Set<number> };

function load(db: Db, now: number): Loaded[] {
  const rows = promotionsRepo.listPriced(db, now);
  if (rows.length === 0) return [];
  const targets = promotionsRepo.targetsFor(db, rows.map((r) => r.id));
  return rows.map((row) => {
    const t = targets.get(row.id) ?? { productIds: [], categoryIds: [] };
    return { row, products: new Set(t.productIds), categories: new Set(t.categoryIds) };
  });
}

/** Цена каждой строки с учётом акций. Строка без подходящей акции возвращается со своей ценой. */
export function priceLinesWithPromotions(db: Db, lines: PromotionLine[], now: number): Map<number, PromotionLinePrice> {
  const out = new Map<number, PromotionLinePrice>();
  const plain = (l: PromotionLine): PromotionLinePrice => ({ unit: l.ownKopecks, original: l.ownKopecks < l.listKopecks ? l.listKopecks : null, promotionId: null });
  const promotions = lines.length > 0 ? load(db, now) : [];
  if (promotions.length === 0) {
    for (const l of lines) out.set(l.productId, plain(l));
    return out;
  }
  const subtotal = lines.reduce((sum, l) => sum + l.ownKopecks * l.qty, 0);
  const parents = promotionsRepo.categoryParents(db);
  const productCategory = promotionsRepo.productCategories(db, lines.map((l) => l.productId));

  const inCategory = (productId: number, wanted: Set<number>): boolean => {
    let id: number | null | undefined = productCategory.get(productId);
    const seen = new Set<number>();
    while (id != null && !seen.has(id)) {
      if (wanted.has(id)) return true;
      seen.add(id);
      id = parents.get(id);
    }
    return false;
  };

  for (const l of lines) {
    let best: { p: Loaded; price: number; discount: number } | null = null;
    for (const p of promotions) {
      if (subtotal < p.row.minSubtotalKopecks) continue;
      if (!p.products.has(l.productId) && !inCategory(l.productId, p.categories)) continue;
      const price = promotionPrice(l.listKopecks, p.row);
      if (price === null) continue;
      const discount = l.listKopecks - price;
      if (!best || p.row.priority > best.p.row.priority || (p.row.priority === best.p.row.priority && (discount > best.discount || (discount === best.discount && p.row.id < best.p.row.id)))) {
        best = { p, price, discount };
      }
    }
    // более низкая из двух цен: акционная или собственная скидочная; цены не суммируются
    if (best && best.price < l.ownKopecks) out.set(l.productId, { unit: best.price, original: l.listKopecks, promotionId: best.p.row.id });
    else out.set(l.productId, plain(l));
  }
  return out;
}
