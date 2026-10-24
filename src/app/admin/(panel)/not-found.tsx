import Link from 'next/link';
import { EmptyState } from '@/ui/admin/kit/EmptyState';

/** Страницы админки, которой нет (или объект не найден). */
export default function AdminNotFound() {
  return (
    <div className="ak-card">
      <EmptyState
        title="Страница не найдена"
        icon="search"
        action={
          <Link href="/admin" className="ak-btn ak-btn--primary">
            На главную
          </Link>
        }
      >
        <p>Адрес указан неверно или объект уже удалён.</p>
      </EmptyState>
    </div>
  );
}
