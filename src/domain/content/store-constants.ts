/** Справочники страницы «Настройки магазина»: чистые константы без БД (их импортирует и клиентская форма). */
/** Типы соцсетей страницы настроек: ключ → подпись для подвала. */
export const SOCIAL_TYPES: readonly { key: string; label: string }[] = [
  { key: 'telegram', label: 'Telegram' },
  { key: 'vk', label: 'ВКонтакте' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'ok', label: 'Одноклассники' },
  { key: 'rutube', label: 'RuTube' },
  { key: 'dzen', label: 'Дзен' },
  { key: 'viber', label: 'Viber' },
  { key: 'other', label: 'Другая ссылка' },
];
export const MAX_SOCIAL_LINKS = 12;

/** Слоган по умолчанию — из брифа; редактируется на странице настроек. */
export const DEFAULT_TAGLINE = 'РемТехСад — профессиональный подход к садовой технике: подберём новую, починим старую';
export const DEFAULT_CURRENCY = 'RUB';
export const DEFAULT_TIMEZONE = 'Europe/Moscow';

/** Валюты: ISO-код → символ и название. Деньги в системе всегда в копейках; код влияет только на показ. */
export const CURRENCIES: Readonly<Record<string, { symbol: string; label: string }>> = {
  RUB: { symbol: '₽', label: 'Рубль (₽)' },
  BYN: { symbol: 'Br', label: 'Белорусский рубль (Br)' },
  KZT: { symbol: '₸', label: 'Тенге (₸)' },
  UAH: { symbol: '₴', label: 'Гривна (₴)' },
  USD: { symbol: '$', label: 'Доллар США ($)' },
  EUR: { symbol: '€', label: 'Евро (€)' },
};

export const COUNTRIES: readonly { value: string; label: string }[] = [
  { value: 'RU', label: 'Россия' },
  { value: 'BY', label: 'Беларусь' },
  { value: 'KZ', label: 'Казахстан' },
  { value: 'AM', label: 'Армения' },
  { value: 'KG', label: 'Киргизия' },
  { value: 'UZ', label: 'Узбекистан' },
];

/** Часовые пояса (IANA) для выбора; допустимость любого значения — isValidTimeZone. */
export const TIME_ZONES: readonly { value: string; label: string }[] = [
  { value: 'Europe/Kaliningrad', label: '(UTC+02:00) Калининград' },
  { value: 'Europe/Moscow', label: '(UTC+03:00) Москва, Санкт-Петербург' },
  { value: 'Europe/Samara', label: '(UTC+04:00) Самара' },
  { value: 'Asia/Yekaterinburg', label: '(UTC+05:00) Екатеринбург' },
  { value: 'Asia/Omsk', label: '(UTC+06:00) Омск' },
  { value: 'Asia/Krasnoyarsk', label: '(UTC+07:00) Красноярск' },
  { value: 'Asia/Irkutsk', label: '(UTC+08:00) Иркутск' },
  { value: 'Asia/Yakutsk', label: '(UTC+09:00) Якутск' },
  { value: 'Asia/Vladivostok', label: '(UTC+10:00) Владивосток' },
  { value: 'Asia/Magadan', label: '(UTC+11:00) Магадан' },
  { value: 'Asia/Kamchatka', label: '(UTC+12:00) Камчатка' },
  { value: 'Europe/Minsk', label: '(UTC+03:00) Минск' },
  { value: 'Asia/Almaty', label: '(UTC+05:00) Алматы' },
  { value: 'UTC', label: 'UTC' },
];

export function isValidTimeZone(tz: string): boolean {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z_+\-0-9]+){0,2}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type SocialEntry = { type: string; url: string };
