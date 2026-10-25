'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Переключатель «Показывать цены» для витрины. Значение приходит с сервера (layout группы (shop)); карточки товаров
 * рисуются и на сервере, и в клиентских списках («Показать ещё»), поэтому читать БД напрямую они не могут.
 * Это только скрытие в интерфейсе: корзина и оформление закрыты на сервере отдельно (store-flags / proxy).
 */
const PricesContext = createContext(true);

export function PricesProvider({ showPrices, children }: { showPrices: boolean; children: ReactNode }) {
  return <PricesContext.Provider value={showPrices}>{children}</PricesContext.Provider>;
}

/** Показывает содержимое (цену, «В корзину»), только когда цены включены. */
export function PricesOnly({ children }: { children: ReactNode }) {
  return useContext(PricesContext) ? <>{children}</> : null;
}
