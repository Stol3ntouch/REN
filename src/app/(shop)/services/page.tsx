import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getServiceCategoryBySlug, isSectionHidden, listPublishedServices, listServiceCategories } from '@/domain/content/queries';
import { contentMetadata } from '@/domain/content/seo';
import { ServiceCard } from '@/ui/home/cards';
import { Placeholder } from '@/ui/placeholder';
import { EmptyState } from '@/ui/states';
import { RepairForm } from '@/ui/forms/forms';
import '@/ui/home/home.css';

export const metadata: Metadata = contentMetadata({ title: 'Ремонт и услуги', fallbackDescription: 'Ремонт садовой техники и другие услуги магазина «РемТехСад».', path: '/services' });

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  await connection();
  if (isSectionHidden('services')) notFound(); // администратор скрыл раздел целиком
  const sp = await searchParams;
  const categories = listServiceCategories();
  const category = sp.category ? getServiceCategoryBySlug(sp.category) : null;
  if (sp.category && !category) notFound();
  const services = listPublishedServices({ categoryId: category?.id ?? null });
  return (
    <>
      <h1>{category ? `Ремонт и услуги: ${category.name}` : 'Ремонт и услуги'}</h1>
      {categories.length > 0 ? (
        <nav className="pager" aria-label="Категории услуг">
          <Link href="/services" aria-current={category ? undefined : 'page'}>
            Все
          </Link>
          {categories.map((c) => (
            <Link key={c.id} href={`/services?category=${encodeURIComponent(c.slug)}`} aria-current={category?.id === c.id ? 'page' : undefined}>
              {c.name} ({c.count})
            </Link>
          ))}
        </nav>
      ) : null}
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
