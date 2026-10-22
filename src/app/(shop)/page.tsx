import { EmptyState } from '@/ui/states';

/** Главная-заглушка: блоки витрины (слайдер, категории, товары) добавят следующие задачи. */
export default function HomePage() {
  return (
    <>
      <h1>РемТехСад</h1>
      <EmptyState title="Магазин готовится к открытию">
        <p>Каталог товаров появится здесь в ближайшее время.</p>
      </EmptyState>
    </>
  );
}
