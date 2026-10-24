import type { ReactNode } from 'react';

/** Заголовок страницы: h1, пояснение и кнопки действий справа (на узком экране — под заголовком). */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="ak-pagehead">
      <div className="ak-pagehead__text">
        <h1>{title}</h1>
        {description ? <p className="ak-pagehead__desc">{description}</p> : null}
      </div>
      {actions ? <div className="ak-pagehead__actions">{actions}</div> : null}
    </header>
  );
}
