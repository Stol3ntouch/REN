import { LoadingState } from '@/ui/admin/kit/LoadingState';

/** Пока страница админки готовится на сервере: скелет вместо пустого экрана (без бесконечного спиннера). */
export default function AdminLoading() {
  return (
    <div className="ak-card" aria-live="polite">
      <LoadingState label="Загрузка страницы…" lines={6} />
    </div>
  );
}
