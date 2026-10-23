const MSK = 'Europe/Moscow';

/** «22 октября 2026» — дата по Москве. */
export function formatDate(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: MSK }).format(new Date(ms));
}

/** Дата для <time datetime>: ГГГГ-ММ-ДД по Москве. */
export function isoDate(ms: number): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: MSK }).format(new Date(ms));
}
