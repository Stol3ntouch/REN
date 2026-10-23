import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { favorites } from '@/domain/customers/favorites';
import { resolveOwner } from '@/domain/customers/session';
import '@/app/(shop)/account/(area)/account.css';
import '@/ui/cart/cart.css';
import '@/ui/catalog/catalog.css';
import { ProductCard } from '@/ui/catalog/ProductCard';
import { EmptyState } from '@/ui/states';
import { removeFavoriteAction } from './actions';

export const metadata: Metadata = { title: 'Избранное', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function FavoritesPage() {
  const owner = resolveOwner(await cookies());
  const items = favorites.cards(owner);

  return (
    <div className="account container">
      <h1 className="account__title">Избранное</h1>
      {items.length === 0 ? (
        <EmptyState title="В избранном пока ничего нет">
          <p>
            Отмечайте товары сердечком в <Link href="/catalog">каталоге</Link> — они появятся здесь.
          </p>
        </EmptyState>
      ) : (
        <ul className="product-grid" aria-label="Избранные товары">
          {items.map((p) => (
            <li key={p.id}>
              <ProductCard product={p} />
              <form action={removeFavoriteAction} className="fav-grid__remove">
                <input type="hidden" name="productId" value={p.id} />
                <button type="submit" className="link-button" aria-label={`Убрать из избранного: ${p.name}`}>
                  Убрать из избранного
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
