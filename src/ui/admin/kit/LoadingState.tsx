/**
 * Загрузка: каркас-«скелет» без вечного спиннера. `lines` — число строк-заглушек.
 * Для обновления внутри страницы (кнопка, форма) используйте aria-busy на самом элементе.
 */
export function LoadingState({ label = 'Загрузка…', lines = 4 }: { label?: string; lines?: number }) {
  return (
    <div className="ak-state ak-state--loading" role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      <div aria-hidden="true" className="ak-skeletons">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="ak-skeleton" style={{ width: `${92 - ((i * 13) % 40)}%` }} />
        ))}
      </div>
    </div>
  );
}
