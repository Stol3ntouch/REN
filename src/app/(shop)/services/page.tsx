import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getShopInfo } from '@/domain/content/settings';
import { listPublishedServices } from '@/domain/content/queries';
import { contentMetadata } from '@/domain/content/seo';
import { ServiceCard } from '@/ui/home/cards';
import { Placeholder } from '@/ui/placeholder';
import { EmptyState } from '@/ui/states';
import '@/ui/home/home.css';

export const metadata: Metadata = contentMetadata({ title: 'Ремонт и услуги', fallbackDescription: 'Ремонт садовой техники и другие услуги магазина «РемТехСад».', path: '/services' });

export default async function ServicesPage() {
  await connection();
  const services = listPublishedServices();
  const shop = getShopInfo();
  return (
    <>
      <h1>Ремонт и услуги</h1>
      {services.length === 0 ? (
        <EmptyState title="Список услуг появится здесь">
          <p>
            <Placeholder label="СПИСОК УСЛУГ" />
          </p>
        </EmptyState>
      ) : (
        <ul className="info-grid">
          {services.map((s) => (
            <li key={s.id}>
              <ServiceCard item={s} />
            </li>
          ))}
        </ul>
      )}
      {/* Якорь для формы заявки на ремонт (T09 вставляет форму сюда). */}
      <section id="repair-form" className="anchor-slot" aria-labelledby="repair-form-title">
        <h2 id="repair-form-title">Заявка на ремонт</h2>
        <p>
          Форма заявки скоро появится на этой странице.
          {shop.phone ? (
            <>
              {' '}
              А пока позвоните: <a href={shop.phoneHref ?? undefined}>{shop.phone}</a>.
            </>
          ) : null}
        </p>
      </section>
    </>
  );
}
