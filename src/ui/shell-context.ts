import { connection } from 'next/server';
import { setDeliveryPaymentTextProvider } from '@/domain/catalog/shop-text';
import { getSetting } from '@/domain/content/settings';
import { loadShellContext } from '@/domain/content/shell';

/**
 * Данные магазина для шапки и подвала. getShellContext() читает настройки магазина и контент (T08);
 * без данных поля пустые, и каркас показывает метки-заглушки. DEFAULT_SHELL — «ничего не задано».
 */
export type ShellLink = { href: string; label: string };

export type ShellContext = {
  siteName: string;
  address?: string;
  phone?: string;
  /** tel:+79166550606 — собирается из телефона. */
  phoneHref?: string;
  /** Путь или URL логотипа; нет — показывается [ЛОГОТИП — загрузи]. */
  logoUrl?: string;
  hours?: string;
  email?: string;
  requisites?: string;
  /** Только заданные соцссылки. */
  socials?: ShellLink[];
  /** Основное меню без пустых разделов; нет — стандартное MAIN_NAV. */
  nav?: ShellLink[];
  /** Корневые категории каталога для подвала. */
  catalogLinks?: ShellLink[];
  buyerLinks?: ShellLink[];
  companyLinks?: ShellLink[];
};

export const DEFAULT_SHELL: ShellContext = { siteName: 'РемТехСад' };

// Текст «Доставка и оплата» на карточке товара берётся из настроек магазина (ключ delivery_payment_text).
// Регистрация при загрузке модуля: каркас (shop) подключается до страниц товара.
setDeliveryPaymentTextProvider(() => getSetting('delivery_payment_text'));

export async function getShellContext(): Promise<ShellContext> {
  await connection(); // читает БД: не пререндерить на сборке
  return loadShellContext();
}
