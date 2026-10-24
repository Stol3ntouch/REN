import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findNavEntryByPath } from '../nav-core';
import { EmptyState } from './EmptyState';
import { PageHeader } from './PageHeader';

/**
 * Содержимое заглушки для пункта меню, страница которого ещё не сдана (метка `pending` в nav-core.ts).
 * Используется общим маршрутом `[...soon]` и однострочными страницами-заглушками там, где существующий динамический
 * маршрут иначе ответил бы 404. Право пункта проверяет вызывающая страница (requireStaffPage) ДО этого компонента.
 */
export function SoonView({ href }: { href: string }) {
  const entry = findNavEntryByPath(href);
  if (!entry || !entry.pending) notFound();
  return (
    <div className="ak-soon">
      <PageHeader title={entry.label} />
      <div className="ak-card">
        <EmptyState title="Раздел в разработке" icon="wrench">
          <p>Раздел появится после завершения сборки.</p>
          {entry.interim ? (
            <p>
              Пока доступно: <Link href={entry.interim.href}>{entry.interim.label}</Link>.
            </p>
          ) : null}
        </EmptyState>
      </div>
    </div>
  );
}
