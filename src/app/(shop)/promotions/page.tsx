import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { listActivePromotions } from '@/domain/content/queries';
import { contentMetadata } from '@/domain/content/seo';
import { PromotionCard } from '@/ui/home/cards';
import '@/ui/home/home.css';

export const metadata: Metadata = contentMetadata({ title: 'Акции', fallbackDescription: 'Действующие акции магазина «РемТехСад».', path: '/promotions' });

/** Раздел скрыт, пока нет действующих акций. */
export default async function PromotionsPage() {
  await connection();
  const items = listActivePromotions();
  if (items.length === 0) notFound();
  return (
    <>
      <h1>Акции</h1>
      <ul className="info-grid">
        {items.map((p) => (
          <li key={p.id}>
            <PromotionCard item={p} />
          </li>
        ))}
      </ul>
    </>
  );
}
