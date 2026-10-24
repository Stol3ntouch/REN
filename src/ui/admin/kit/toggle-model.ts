export type ToggleResult = void | undefined | { ok: boolean; message?: string };
export type ToggleAction = (next: boolean) => Promise<ToggleResult> | ToggleResult;

export const TOGGLE_FAILED = 'Не удалось сохранить изменение. Попробуйте ещё раз.';

/**
 * Оптимистичное переключение: вернуть итоговое состояние после вызова действия.
 * Действие прошло (или вернуло `{ok:true}`/ничего) → новое значение; бросило исключение или вернуло `{ok:false}` →
 * откат к прежнему значению и текст ошибки для пользователя.
 */
export async function runOptimistic(current: boolean, action: ToggleAction): Promise<{ checked: boolean; error: string | null }> {
  const next = !current;
  try {
    const result = await action(next);
    if (result && typeof result === 'object' && result.ok === false) return { checked: current, error: result.message ?? TOGGLE_FAILED };
    return { checked: next, error: null };
  } catch {
    return { checked: current, error: TOGGLE_FAILED };
  }
}
