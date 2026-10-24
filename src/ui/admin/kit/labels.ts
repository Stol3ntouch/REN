/** Подписи ролей сотрудников; неизвестная роль (добавленная позже) выводится как есть. */
export const ROLE_LABELS: Readonly<Record<string, string>> = {
  super_admin: 'Главный администратор',
  admin: 'Администратор',
  manager: 'Менеджер',
  content_manager: 'Контент-менеджер',
  warehouse: 'Кладовщик',
  service: 'Сервис',
};

export const roleLabel = (role: string): string => ROLE_LABELS[role] ?? role;

/** Первая буква имени (или логина) для аватара. */
export function initialOf(name: string | null | undefined, fallback: string): string {
  const source = (name ?? '').trim() || fallback.trim();
  return (Array.from(source)[0] ?? '?').toUpperCase();
}
