/**
 * Данные магазина для шапки и подвала. Пока настроек в БД нет — пусто, и каркас
 * показывает метки-заглушки. Задача «контент/настройки» заменит тело getShellContext()
 * чтением настроек магазина (адрес, телефон, логотип); потребители не меняются.
 */
export type ShellContext = {
  siteName: string;
  address?: string;
  phone?: string;
  /** Путь или URL загруженного логотипа; нет — показывается [ЛОГОТИП — загрузи]. */
  logoUrl?: string;
};

export const DEFAULT_SHELL: ShellContext = { siteName: 'РемТехСад' };

export async function getShellContext(): Promise<ShellContext> {
  return DEFAULT_SHELL;
}
