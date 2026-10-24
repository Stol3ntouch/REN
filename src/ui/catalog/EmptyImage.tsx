/** Нейтральная иконка вместо фото: товара без фото и фото, которое не загрузилось. */
export function EmptyImage({ name }: { name: string }) {
  return (
    <span className="product-image product-image--empty" role="img" aria-label={name ? `Фото товара «${name}» отсутствует` : 'Фото отсутствует'}>
      <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" focusable="false">
        <path fill="none" stroke="currentColor" strokeWidth="1.5" d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.5h.01" />
      </svg>
    </span>
  );
}
