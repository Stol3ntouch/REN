export type PriceInput = { priceKopecks: number; discountPriceKopecks?: number | null };
export type ResolvedPrice = { unit: number; original?: number };

/**
 * Цена за единицу. Скидочная цена действует только при 0 < discount < price (R37);
 * иначе — розничная. original задан только когда скидка действует (его показывают зачёркнутым).
 */
export function resolvePrice(p: PriceInput): ResolvedPrice {
  const d = p.discountPriceKopecks;
  if (d !== null && d !== undefined && d > 0 && d < p.priceKopecks) return { unit: d, original: p.priceKopecks };
  return { unit: p.priceKopecks };
}
