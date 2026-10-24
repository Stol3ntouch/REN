import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { isSectionHidden, listPublishedServices } from '@/domain/content/queries';
import { contentMetadata } from '@/domain/content/seo';
import { ServiceCard } from '@/ui/home/cards';
import { Placeholder } from '@/ui/placeholder';
import { EmptyState } from '@/ui/states';
import { RepairForm } from '@/ui/forms/forms';
import '@/ui/home/home.css';

export const metadata: Metadata = contentMetadata({ title: 'Ремонт и услуги', fallbackDescription: 'Ремонт садовой техники и другие услуги магазина «РемТехСад».', path: '/services' });

export default async function ServicesPage() {
  await connection();
  if (isSectionHidden('services')) notFound(); // администратор скрыл раздел целиком
  const services = listPublishedServices();
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
      <section id="repair-form" className="form-section" aria-labelledby="repair-form-title">
        <h2 id="repair-form-title">Заявка на ремонт</h2>
        <RepairForm />
      </section>
    </>
  );
}
