/** Показ цены на витрине: что считается «старой» ценой и сколько процентов скидки можно честно показать. */

/**
 * Зачёркнутая цена. Кандидаты: обычная цена при действующей скидочной и «старая цена» из карточки.
 * Берётся наибольшая из тех, что строго выше цены к оплате; ни одной — нет (ничего не показываем).
 */
export function originalPrice(unitKopecks: number, price: number, discount: number | null, oldPrice: number | null): number | undefined {
  const candidates: number[] = [];
  if (discount !== null && discount < price) candidates.push(price);
  if (oldPrice !== null && oldPrice > unitKopecks) candidates.push(oldPrice);
  const best = Math.max(0, ...candidates);
  return best > unitKopecks ? best : undefined;
}

/**
 * «−N %» — только при реальной старой цене выше цены к оплате и скидке от 1 %. Округление вниз: лучше недообещать,
 * чем показать «−20 %» там, где скидка 19,6 %.
 */
export function discountPercent(unitKopecks: number, originalKopecks: number | undefined | null): number | null {
  if (originalKopecks === undefined || originalKopecks === null || unitKopecks <= 0 || originalKopecks <= unitKopecks) return null;
  const pct = Math.floor(((originalKopecks - unitKopecks) * 100) / originalKopecks);
  return pct >= 1 ? pct : null;
}
