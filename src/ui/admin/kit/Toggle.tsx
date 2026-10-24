'use client';

import { useId, useRef, useState } from 'react';
import { runOptimistic, type ToggleAction } from './toggle-model';
import { useToast } from './Toaster';

/**
 * Переключатель (role="switch"). Сразу показывает новое значение; если `action` (server action) вернул ошибку
 * или бросил исключение — откатывает и сообщает об ошибке. Без `action` работает как поле формы: значение уходит
 * в форму скрытым полем `name` ('1' / '0').
 */
export function Toggle({
  checked,
  label,
  action,
  name,
  disabled = false,
  hideLabel = false,
  description,
}: {
  checked: boolean;
  label: string;
  action?: ToggleAction;
  name?: string;
  disabled?: boolean;
  hideLabel?: boolean;
  description?: string;
}) {
  const toast = useToast();
  const labelId = useId();
  const [value, setValue] = useState(checked);
  const [seen, setSeen] = useState(checked);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  // Сервер прислал новое значение (список обновился) — берём его.
  if (checked !== seen) {
    setSeen(checked);
    setValue(checked);
  }

  async function onClick(): Promise<void> {
    if (disabled || busy.current) return;
    if (!action) {
      setValue(!value);
      return;
    }
    busy.current = true;
    const before = value;
    setValue(!before);
    setPending(true);
    setError(null);
    const result = await runOptimistic(before, action);
    setValue(result.checked);
    setPending(false);
    busy.current = false;
    if (result.error) {
      setError(result.error);
      toast.error(result.error);
    }
  }

  return (
    <span className="ak-toggle">
      <button type="button" role="switch" aria-checked={value} aria-label={hideLabel ? label : undefined} aria-labelledby={hideLabel ? undefined : labelId} aria-busy={pending || undefined} disabled={disabled} className="ak-switch" onClick={onClick}>
        <span className="ak-switch__thumb" aria-hidden="true" />
      </button>
      {hideLabel ? null : <span id={labelId} className="ak-toggle__label">
          {label}
        </span>}
      {description ? <span className="ak-toggle__desc">{description}</span> : null}
      {name ? <input type="hidden" name={name} value={value ? '1' : '0'} /> : null}
      {error ? (
        <span className="ak-toggle__error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
