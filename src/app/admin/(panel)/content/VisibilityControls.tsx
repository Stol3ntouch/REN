import type { HideableSection } from '@/domain/content/queries';
import { setPageHiddenAction, setSectionHiddenAction } from './actions';

/**
 * Кнопка «Скрыть»/«Показать» у страницы сайта. Для страниц, на которые ссылаются формы (политика ПДн),
 * кнопка неактивна и рядом объяснение; сервер отказывает в любом случае (contentOps.pages.setHidden).
 */
export function PageVisibilityControl({ id, hidden, locked = false }: { id: number; hidden: boolean; locked?: boolean }) {
  const canToggle = !locked || hidden; // вернуть защищённую страницу можно всегда
  return (
    <form action={setPageHiddenAction} className="adm-inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="hidden" value={hidden ? '0' : '1'} />
      <button type="submit" className="button button--outline" disabled={!canToggle} aria-describedby={locked ? `page-lock-${id}` : undefined}>
        {hidden ? 'Показать' : 'Скрыть'}
      </button>
      {locked ? (
        <span id={`page-lock-${id}`} className="adm-hint">
          Скрыть нельзя: на страницу ссылаются формы сайта (согласие на обработку персональных данных).
        </span>
      ) : null}
    </form>
  );
}

const SECTION_NAMES: Record<HideableSection, string> = { news: 'новостей', promotions: 'акций', services: 'услуг' };

/** Состояние раздела целиком и кнопка его скрытия/показа. Записи раздела не меняются. */
export function SectionVisibilityControl({ section, hidden }: { section: HideableSection; hidden: boolean }) {
  return (
    <form action={setSectionHiddenAction} className="adm-card" aria-label={`Раздел ${SECTION_NAMES[section]} на сайте`}>
      <input type="hidden" name="section" value={section} />
      <input type="hidden" name="hidden" value={hidden ? '0' : '1'} />
      <p>
        <strong>{hidden ? 'Раздел скрыт на сайте' : 'Раздел показан на сайте'}</strong>
        {hidden
          ? ': его адрес даёт 404, ссылок в меню, подвале и карте сайта нет. Записи сохранены.'
          : `. Пока в разделе нет опубликованных записей, ссылки на него в меню нет. Скрыть раздел ${SECTION_NAMES[section]} целиком можно кнопкой.`}
      </p>
      <button type="submit" className="button button--outline">
        {hidden ? 'Показать раздел' : 'Скрыть раздел'}
      </button>
    </form>
  );
}
