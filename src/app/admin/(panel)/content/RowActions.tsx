import Link from 'next/link';
import type { ListEntityKey } from '@/domain/content/fields';
import { ConfirmButton } from '@/ui/admin/kit/ConfirmButton';
import { deleteEntityAction, duplicateEntityAction, toggleEntityAction } from './actions';

/**
 * Действия в строке списка: изменить, дублировать, скрыть/показать, удалить (с подтверждением).
 * Каждая кнопка — своя форма с server action; после действия список остаётся с теми же фильтрами (поле back).
 */
export function RowActions({
  entity,
  id,
  name,
  back,
  visible,
  canToggle = true,
  canDuplicate = true,
  canDelete = true,
  deleteNote,
}: {
  entity: ListEntityKey;
  id: number;
  name: string;
  back: string;
  /** Сейчас показывается на сайте (для подписи кнопки). */
  visible?: boolean;
  canToggle?: boolean;
  canDuplicate?: boolean;
  canDelete?: boolean;
  deleteNote?: string;
}) {
  const hidden = (
    <>
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="back" value={back} />
    </>
  );
  return (
    <div className="ak-row-actions">
      <Link className="ak-btn ak-btn--sm ak-btn--outline" href={`/admin/content/${entity}/${id}`} aria-label={`Изменить: ${name}`}>
        Изменить
      </Link>
      {canDuplicate ? (
        <form action={duplicateEntityAction}>
          {hidden}
          <button type="submit" className="ak-btn ak-btn--sm ak-btn--outline" aria-label={`Дублировать: ${name}`}>
            Дублировать
          </button>
        </form>
      ) : null}
      {canToggle && visible !== undefined ? (
        <form action={toggleEntityAction}>
          {hidden}
          <input type="hidden" name="show" value={visible ? '0' : '1'} />
          <button type="submit" className="ak-btn ak-btn--sm ak-btn--outline" aria-label={`${visible ? 'Скрыть' : 'Показать'}: ${name}`}>
            {visible ? 'Скрыть' : 'Показать'}
          </button>
        </form>
      ) : null}
      {canDelete ? (
        <form action={deleteEntityAction}>
          {hidden}
          <ConfirmButton title={`Удалить «${name}»?`} description={deleteNote ?? 'Запись будет удалена без возможности восстановления.'} confirmLabel="Удалить" className="ak-btn ak-btn--sm ak-btn--danger-outline" aria-label={`Удалить: ${name}`}>
            Удалить
          </ConfirmButton>
        </form>
      ) : null}
    </div>
  );
}
